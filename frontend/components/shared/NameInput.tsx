/**
 * NameInput — 可复用的名称输入框
 *
 * 用法：
 * - 默认样式（蓝色焦点）：<NameInput value={v} onChange={setV} />
 * - 自定义样式：<NameInput value={v} onChange={setV} useCustomStyle={false} className={fieldCls} />
 *
 * 默认样式特点：
 * - 当输入框为空时：蓝色边框 + 淡蓝背景，视觉提示用户必填
 * - 当输入框有内容时：灰色边框 + 白色背景，正常样式
 */

interface NameInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  useCustomStyle?: boolean;  // 如果 false，使用 className 而不是内置样式
}

export default function NameInput({
  value,
  onChange,
  placeholder = '请输入名称',
  className = '',
  useCustomStyle = true,
}: NameInputProps) {
  const isEmpty = !value.trim();

  if (!useCustomStyle) {
    // 使用外部 className，忽略内置样式
    return (
      <input
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={className}
      />
    );
  }

  // 使用默认的内置样式
  return (
    <input
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        border: isEmpty ? '1px solid #4f46e5' : '1px solid #ddd',
        fontSize: 13,
        background: isEmpty ? '#f0f0ff' : '#fff',
        transition: 'all 0.2s',
        width: '100%',
        boxSizing: 'border-box',
      }}
    />
  );
}
