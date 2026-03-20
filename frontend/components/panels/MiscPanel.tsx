import type { MiscSubPage, Status, ChatMessage } from '../../types';
import ImageUnderstandSection from './misc/ImageUnderstandSection';
import TranslateSection from './misc/TranslateSection';
import CodeAssistSection from './misc/CodeAssistSection';
import ImgGenSection from './misc/ImgGenSection';
import ImgI2iSection from './misc/ImgI2iSection';
import VideoGenSection from './misc/VideoGenSection';
import OcrSection from './misc/OcrSection';
import LipsyncSection from './misc/LipsyncSection';

interface MiscPanelProps {
  miscSubPage: MiscSubPage;
  setMiscSubPage: (p: MiscSubPage) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
  status: Status;
  // image gen (cloud) — legacy, kept for compatibility
  imageGenProvider: string;
  onImageGenProviderChange: (p: string) => void;
  imageGenPrompt: string;
  setImageGenPrompt: (t: string) => void;
  imageGenModel: string;
  setImageGenModel: (m: string) => void;
  imageGenSize: string;
  setImageGenSize: (s: string) => void;
  onRunImageGen: () => void;
  // image understand
  imageUnderstandProvider: string;
  onImageUnderstandProviderChange: (p: string) => void;
  imageUnderstandFile: File | null;
  setImageUnderstandFile: (f: File | null) => void;
  imageUnderstandPrompt: string;
  setImageUnderstandPrompt: (t: string) => void;
  imageUnderstandModel: string;
  setImageUnderstandModel: (m: string) => void;
  onRunImageUnderstand: () => void;
  // translate
  translateProvider: string;
  setTranslateProvider: (p: string) => void;
  translateText: string;
  setTranslateText: (t: string) => void;
  translateTarget: string;
  setTranslateTarget: (l: string) => void;
  translateSource: string;
  setTranslateSource: (l: string) => void;
  translateModel: string;
  setTranslateModel: (m: string) => void;
  onRunTranslate: () => void;
  // code assist
  codeProvider: string;
  setCodeProvider: (p: string) => void;
  codeModel: string;
  setCodeModel: (m: string) => void;
  codeMessages: ChatMessage[];
  setCodeMessages: (msgs: ChatMessage[]) => void;
  codeInput: string;
  setCodeInput: (t: string) => void;
  codeLoading: boolean;
  codeLang: string;
  setCodeLang: (l: string) => void;
  onSendCodeMessage: () => void;
  // img gen (local+cloud)
  imgGenProvider: string;
  onImgGenProviderChange: (p: string) => void;
  imgGenPrompt: string;
  setImgGenPrompt: (t: string) => void;
  imgGenModel: string;
  setImgGenModel: (m: string) => void;
  imgGenSize: string;
  setImgGenSize: (s: string) => void;
  imgGenComfyUrl: string;
  setImgGenComfyUrl: (u: string) => void;
  onRunImgGen: () => void;
  // img i2i
  imgI2iProvider: string;
  onImgI2iProviderChange: (p: string) => void;
  imgI2iSourceFile: File | null;
  setImgI2iSourceFile: (f: File | null) => void;
  imgI2iRefFile: File | null;
  setImgI2iRefFile: (f: File | null) => void;
  imgI2iPrompt: string;
  setImgI2iPrompt: (t: string) => void;
  imgI2iModel: string;
  setImgI2iModel: (m: string) => void;
  imgI2iStrength: number;
  setImgI2iStrength: (v: number) => void;
  imgI2iComfyUrl: string;
  setImgI2iComfyUrl: (u: string) => void;
  onRunImgI2i: () => void;
  // video gen
  videoGenProvider: string;
  onVideoGenProviderChange: (p: string) => void;
  videoGenPrompt: string;
  setVideoGenPrompt: (t: string) => void;
  videoGenModel: string;
  setVideoGenModel: (m: string) => void;
  videoGenDuration: number;
  setVideoGenDuration: (d: number) => void;
  videoGenMode: 't2v' | 'i2v';
  setVideoGenMode: (m: 't2v' | 'i2v') => void;
  videoGenImageFile: File | null;
  setVideoGenImageFile: (f: File | null) => void;
  onRunVideoGen: () => void;
  // ocr
  ocrProvider: string;
  onOcrProviderChange: (p: string) => void;
  ocrFile: File | null;
  setOcrFile: (f: File | null) => void;
  ocrModel: string;
  setOcrModel: (m: string) => void;
  ocrLocalUrl: string;
  setOcrLocalUrl: (u: string) => void;
  onRunOcr: () => void;
  // lipsync
  lipsyncProvider: string;
  onLipsyncProviderChange: (p: string) => void;
  lipsyncVideoFile: File | null;
  setLipsyncVideoFile: (f: File | null) => void;
  lipsyncAudioFile: File | null;
  setLipsyncAudioFile: (f: File | null) => void;
  lipsyncModel: string;
  setLipsyncModel: (m: string) => void;
  lipsyncLocalUrl: string;
  setLipsyncLocalUrl: (u: string) => void;
  onRunLipsync: () => void;
  // output
  outputDir: string;
  setOutputDir: (v: string) => void;
  // style
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
  // optional: restrict visible sub-pages
  allowedSubPages?: readonly MiscSubPage[];
}

type MiscTab = { key: MiscSubPage; label: string; abbr: string; bg: string };

const ROW1_TABS: MiscTab[] = [
  { key: 'image_understand', label: '图像理解', abbr: 'IU',   bg: '#7c3aed' },
  { key: 'translate',        label: '文字翻译', abbr: 'TRL',  bg: '#0284c7' },
  { key: 'code_assist',      label: '代码助手', abbr: 'CODE', bg: '#059669' },
];

const ROW2_TABS: MiscTab[] = [
  { key: 'img_gen',   label: '图像生成', abbr: 'T2I', bg: '#db2777' },
  { key: 'img_i2i',  label: '换脸换图', abbr: 'I2I', bg: '#b45309' },
  { key: 'video_gen', label: '视频生成', abbr: 'T2V', bg: '#0f766e' },
];

const ROW3_TABS: MiscTab[] = [
  { key: 'ocr',     label: 'OCR 识别', abbr: 'OCR', bg: '#0369a1' },
  { key: 'lipsync', label: '口型同步', abbr: 'LIP', bg: '#be185d' },
];

function MiscTabIcon({ abbr, bg, size = 22 }: { abbr: string; bg: string; size?: number }) {
  const fs = abbr.length >= 4 ? size * 0.32 : abbr.length >= 3 ? size * 0.36 : size * 0.42;
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <rect width="22" height="22" rx="5.5" fill={bg} />
      <text x="11" y="11" dominantBaseline="central" textAnchor="middle"
        fontSize={fs} fontWeight="700" fill="#fff" fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        {abbr}
      </text>
    </svg>
  );
}

export default function MiscPanel(props: MiscPanelProps) {
  const { miscSubPage, setMiscSubPage, allowedSubPages } = props;

  const ALL_ROWS: MiscTab[][] = [ROW1_TABS, ROW2_TABS, ROW3_TABS];
  const visibleRows = allowedSubPages
    ? ALL_ROWS.map(row => row.filter(tab => allowedSubPages.includes(tab.key))).filter(row => row.length > 0)
    : ALL_ROWS;

  return (
    <div className="space-y-5">
      {/* 子页签（单子页时隐藏，由外部页面负责导航） */}
      {visibleRows.flat().length > 1 && (
        <div className="space-y-1.5">
          {visibleRows.map((row, i) => (
            <div key={i} className="flex gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
              {row.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setMiscSubPage(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all ${
                    miscSubPage === tab.key
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}>
                  <MiscTabIcon abbr={tab.abbr} bg={tab.bg} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {miscSubPage === 'image_understand' && (
        <ImageUnderstandSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          cloudEndpoint={props.cloudEndpoint} setCloudEndpoint={props.setCloudEndpoint}
          imageUnderstandProvider={props.imageUnderstandProvider} onImageUnderstandProviderChange={props.onImageUnderstandProviderChange}
          imageUnderstandFile={props.imageUnderstandFile} setImageUnderstandFile={props.setImageUnderstandFile}
          imageUnderstandPrompt={props.imageUnderstandPrompt} setImageUnderstandPrompt={props.setImageUnderstandPrompt}
          imageUnderstandModel={props.imageUnderstandModel} setImageUnderstandModel={props.setImageUnderstandModel}
          onRunImageUnderstand={props.onRunImageUnderstand}
          labelCls={props.labelCls} fieldCls={props.fieldCls}
        />
      )}

      {miscSubPage === 'translate' && (
        <TranslateSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          cloudEndpoint={props.cloudEndpoint} setCloudEndpoint={props.setCloudEndpoint}
          translateProvider={props.translateProvider} setTranslateProvider={props.setTranslateProvider}
          translateText={props.translateText} setTranslateText={props.setTranslateText}
          translateTarget={props.translateTarget} setTranslateTarget={props.setTranslateTarget}
          translateSource={props.translateSource} setTranslateSource={props.setTranslateSource}
          translateModel={props.translateModel} setTranslateModel={props.setTranslateModel}
          onRunTranslate={props.onRunTranslate}
          labelCls={props.labelCls} fieldCls={props.fieldCls}
        />
      )}

      {miscSubPage === 'code_assist' && (
        <CodeAssistSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          cloudEndpoint={props.cloudEndpoint} setCloudEndpoint={props.setCloudEndpoint}
          codeProvider={props.codeProvider} setCodeProvider={props.setCodeProvider}
          codeModel={props.codeModel} setCodeModel={props.setCodeModel}
          codeMessages={props.codeMessages} setCodeMessages={props.setCodeMessages}
          codeInput={props.codeInput} setCodeInput={props.setCodeInput}
          codeLoading={props.codeLoading}
          codeLang={props.codeLang} setCodeLang={props.setCodeLang}
          onSendCodeMessage={props.onSendCodeMessage}
          labelCls={props.labelCls} fieldCls={props.fieldCls} btnSec={props.btnSec}
        />
      )}

      {miscSubPage === 'img_gen' && (
        <ImgGenSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          imgGenProvider={props.imgGenProvider} onImgGenProviderChange={props.onImgGenProviderChange}
          imgGenPrompt={props.imgGenPrompt} setImgGenPrompt={props.setImgGenPrompt}
          imgGenModel={props.imgGenModel} setImgGenModel={props.setImgGenModel}
          imgGenSize={props.imgGenSize} setImgGenSize={props.setImgGenSize}
          imgGenComfyUrl={props.imgGenComfyUrl} setImgGenComfyUrl={props.setImgGenComfyUrl}
          onRunImgGen={props.onRunImgGen}
          outputDir={props.outputDir} setOutputDir={props.setOutputDir}
          labelCls={props.labelCls} fieldCls={props.fieldCls} btnSec={props.btnSec}
        />
      )}

      {miscSubPage === 'img_i2i' && (
        <ImgI2iSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          imgI2iProvider={props.imgI2iProvider} onImgI2iProviderChange={props.onImgI2iProviderChange}
          imgI2iSourceFile={props.imgI2iSourceFile} setImgI2iSourceFile={props.setImgI2iSourceFile}
          imgI2iRefFile={props.imgI2iRefFile} setImgI2iRefFile={props.setImgI2iRefFile}
          imgI2iPrompt={props.imgI2iPrompt} setImgI2iPrompt={props.setImgI2iPrompt}
          imgI2iModel={props.imgI2iModel} setImgI2iModel={props.setImgI2iModel}
          imgI2iStrength={props.imgI2iStrength} setImgI2iStrength={props.setImgI2iStrength}
          imgI2iComfyUrl={props.imgI2iComfyUrl} setImgI2iComfyUrl={props.setImgI2iComfyUrl}
          onRunImgI2i={props.onRunImgI2i}
          outputDir={props.outputDir} setOutputDir={props.setOutputDir}
          labelCls={props.labelCls} fieldCls={props.fieldCls} btnSec={props.btnSec}
        />
      )}

      {miscSubPage === 'video_gen' && (
        <VideoGenSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          videoGenProvider={props.videoGenProvider} onVideoGenProviderChange={props.onVideoGenProviderChange}
          videoGenPrompt={props.videoGenPrompt} setVideoGenPrompt={props.setVideoGenPrompt}
          videoGenModel={props.videoGenModel} setVideoGenModel={props.setVideoGenModel}
          videoGenDuration={props.videoGenDuration} setVideoGenDuration={props.setVideoGenDuration}
          videoGenMode={props.videoGenMode} setVideoGenMode={props.setVideoGenMode}
          videoGenImageFile={props.videoGenImageFile} setVideoGenImageFile={props.setVideoGenImageFile}
          onRunVideoGen={props.onRunVideoGen}
          outputDir={props.outputDir} setOutputDir={props.setOutputDir}
          labelCls={props.labelCls} fieldCls={props.fieldCls} btnSec={props.btnSec}
        />
      )}

      {miscSubPage === 'ocr' && (
        <OcrSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          ocrProvider={props.ocrProvider} onOcrProviderChange={props.onOcrProviderChange}
          ocrFile={props.ocrFile} setOcrFile={props.setOcrFile}
          ocrModel={props.ocrModel} setOcrModel={props.setOcrModel}
          ocrLocalUrl={props.ocrLocalUrl} setOcrLocalUrl={props.setOcrLocalUrl}
          onRunOcr={props.onRunOcr}
          labelCls={props.labelCls} fieldCls={props.fieldCls}
        />
      )}

      {miscSubPage === 'lipsync' && (
        <LipsyncSection
          status={props.status}
          apiKey={props.apiKey} setApiKey={props.setApiKey}
          lipsyncProvider={props.lipsyncProvider} onLipsyncProviderChange={props.onLipsyncProviderChange}
          lipsyncVideoFile={props.lipsyncVideoFile} setLipsyncVideoFile={props.setLipsyncVideoFile}
          lipsyncAudioFile={props.lipsyncAudioFile} setLipsyncAudioFile={props.setLipsyncAudioFile}
          lipsyncModel={props.lipsyncModel} setLipsyncModel={props.setLipsyncModel}
          lipsyncLocalUrl={props.lipsyncLocalUrl} setLipsyncLocalUrl={props.setLipsyncLocalUrl}
          onRunLipsync={props.onRunLipsync}
          outputDir={props.outputDir} setOutputDir={props.setOutputDir}
          labelCls={props.labelCls} fieldCls={props.fieldCls} btnSec={props.btnSec}
        />
      )}
    </div>
  );
}
