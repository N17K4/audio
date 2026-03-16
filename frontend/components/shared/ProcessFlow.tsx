/**
 * ProcessFlow — 实际运行流程可视化条
 *
 * 在每个 AI 进阶页面顶部显示，让用户直观看到"幕后发生了什么"。
 * 每个节点显示步骤名 + 技术名称，节点间用箭头连接。
 * 节点过多时自动换行。
 */

export interface FlowStep {
  label: string;   // 步骤动作（中文），如"切片"
  tech?: string;   // 使用的技术 / 库（英文），如"SimpleDirectoryReader"
  note?: string;   // 可选补充说明，如"768 维向量"
}

interface Props {
  steps: FlowStep[];
  color?: string;  // 主题色，默认靛蓝
}

export default function ProcessFlow({ steps, color = '#4f46e5' }: Props) {
  return (
    <div style={{
      padding: '10px 14px',
      background: '#f8f8ff',
      borderRadius: 8,
      border: `1px solid ${color}22`,
      marginBottom: 4,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase',
        letterSpacing: 1, marginBottom: 8,
      }}>
        实际运行流程
      </div>

      {/* 流程节点横向排列，自动换行 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* 单个步骤节点 */}
            <div style={{
              padding: '4px 10px',
              borderRadius: 6,
              background: '#fff',
              border: `1px solid ${color}44`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: 64,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#333', whiteSpace: 'nowrap' }}>
                {step.label}
              </span>
              {step.tech && (
                <span style={{
                  fontSize: 10, color, fontFamily: 'monospace',
                  marginTop: 1, whiteSpace: 'nowrap',
                }}>
                  {step.tech}
                </span>
              )}
              {step.note && (
                <span style={{ fontSize: 9, color: '#999', marginTop: 1, whiteSpace: 'nowrap' }}>
                  {step.note}
                </span>
              )}
            </div>

            {/* 箭头（最后一个节点后不加）*/}
            {i < steps.length - 1 && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                style={{ flexShrink: 0, color: '#bbb' }}>
                <path d="M3 8H13M9 4L13 8L9 12"
                  stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
