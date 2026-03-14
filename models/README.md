# Models Directory

This folder is reserved for voice-conversion models.

## Structure
- `models/voices/default_female/`
- `models/voices/default_male/`
- `models/voices/default_kid/`
- `models/uploads/` (user-imported voice packs)

## Suggested file convention per voice folder
- `model.pth` or `model.onnx` (model weights)
- `index.index` (RVC index, optional)
- `meta.json` (display name, engine, sample rate)

Example `meta.json`:
```json
{
  "voice_id": "default_female",
  "name": "Default Female",
  "engine": "rvc",
  "sample_rate": 44100,
  "model_file": "model.pth",
  "index_file": "index.index"
}
```

## Download sources (official/primary)
- RVC project: https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI
- Seed-VC project: https://github.com/Plachtaa/seed-vc
- w-okada voice changer: https://github.com/w-okada/voice-changer
- Hugging Face models hub: https://huggingface.co/models

## Notes
- Keep model license and usage terms with each model package.
- Do not commit large model binaries to git unless necessary.
