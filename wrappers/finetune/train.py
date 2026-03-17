#!/usr/bin/env python3
"""LoRA 微调 CLI 脚本，由嵌入式 Python 运行"""
import argparse
import json
import sys

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--lora_r", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--num_epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=2)
    parser.add_argument("--learning_rate", type=float, default=2e-4)
    parser.add_argument("--max_seq_length", type=int, default=512)
    parser.add_argument("--export_format", default="adapter", choices=["adapter", "merged"])
    return parser.parse_args()


def main():
    args = parse_args()

    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig, get_peft_model, TaskType
        from trl import SFTTrainer, SFTConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    except ImportError as e:
        print(f"[错误] 缺少依赖: {e}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps({"step": 0, "total": args.num_epochs, "status": "loading_model"}), flush=True)

    # QLoRA 4-bit 量化仅在 CUDA 上可用（bitsandbytes 不支持 MPS）
    use_bnb = torch.cuda.is_available()
    if use_bnb:
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
        )
    else:
        bnb_config = None

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    load_kwargs = dict(trust_remote_code=True)
    if bnb_config:
        load_kwargs["quantization_config"] = bnb_config
        load_kwargs["device_map"] = "auto"
    else:
        # Mac / CPU：不量化，float32 + CPU
        load_kwargs["dtype"] = torch.float32
        load_kwargs["device_map"] = "cpu"

    model = AutoModelForCausalLM.from_pretrained(args.model, **load_kwargs)

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules=["q_proj", "v_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)

    print(json.dumps({"step": 0, "total": args.num_epochs, "status": "loading_dataset"}), flush=True)

    dataset = load_dataset("json", data_files=args.dataset, split="train")

    def format_example(example):
        if "instruction" in example and "output" in example:
            text = f"### 指令:\n{example['instruction']}\n\n### 回复:\n{example['output']}"
        elif "prompt" in example and "completion" in example:
            text = f"{example['prompt']}{example['completion']}"
        else:
            text = str(example)
        return {"text": text}

    dataset = dataset.map(format_example)

    import os
    os.makedirs(args.output_dir, exist_ok=True)

    from transformers import TrainerCallback

    class JsonProgressCallback(TrainerCallback):
        def on_log(self, args_t, state, control, logs=None, **kwargs):
            if logs and "loss" in logs:
                print(json.dumps({
                    "step": round(state.epoch, 2),
                    "total": args.num_epochs,
                    "loss": round(logs["loss"], 4),
                    "global_step": state.global_step,
                }), flush=True)

    import inspect

    # macOS MPS 不支持 fp16/bf16 mixed precision（需 PyTorch >= 2.6/2.8）
    # CUDA 可用时开 fp16，否则关闭所有混合精度
    has_cuda = torch.cuda.is_available()

    sft_kwargs = dict(
        output_dir=args.output_dir,
        num_train_epochs=args.num_epochs,
        per_device_train_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        logging_steps=1,
        save_strategy="epoch",
        fp16=has_cuda,
        bf16=False,
        report_to="none",
    )
    # Mac/CPU：强制禁用 MPS，避免 accelerate 自动检测 MPS 后开 bf16
    if not has_cuda:
        sft_kwargs["use_cpu"] = True

    sig_params = inspect.signature(SFTConfig.__init__).parameters
    # max_seq_length 仅部分版本的 SFTConfig 支持
    if "max_seq_length" in sig_params:
        sft_kwargs["max_seq_length"] = args.max_seq_length

    training_args = SFTConfig(**sft_kwargs)

    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        args=training_args,
        callbacks=[JsonProgressCallback()],
    )

    trainer.train()

    print(json.dumps({"step": args.num_epochs, "total": args.num_epochs, "status": "saving"}), flush=True)

    if args.export_format == "merged":
        merged = model.merge_and_unload()
        merged.save_pretrained(args.output_dir)
        tokenizer.save_pretrained(args.output_dir)
        print(json.dumps({"status": "done", "format": "merged", "output_dir": args.output_dir}), flush=True)
    else:
        model.save_pretrained(args.output_dir)
        tokenizer.save_pretrained(args.output_dir)
        print(json.dumps({"status": "done", "format": "adapter", "output_dir": args.output_dir}), flush=True)


if __name__ == "__main__":
    main()
