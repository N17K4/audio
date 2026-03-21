import { useState } from 'react';
import type { TaskType, MiscSubPage } from '../types';
import type { Page } from '../components/layout/Sidebar';

const AUDIO_TASK_TYPES: TaskType[] = ['tts', 'vc', 'asr', 'voice_chat'];

interface UseNavigationParams {
  backendBaseUrl: string;
  setMiscSubPage: (page: MiscSubPage) => void;
  fetchJobs: () => void;
  isDocker?: boolean;
}

export function useNavigation({ backendBaseUrl, setMiscSubPage, fetchJobs, isDocker }: UseNavigationParams) {
  const [taskType, setTaskType] = useState<TaskType>('tts');
  const [showHome, setShowHome] = useState(true);
  const [showTasks, setShowTasks] = useState(false);
  const [tasksTab, setTasksTab] = useState<'tasks' | 'about' | 'models'>('tasks');
  const [showAudioTools, setShowAudioTools] = useState(false);
  const [showFormatConvert, setShowFormatConvert] = useState(false);
  const [showImageTools, setShowImageTools] = useState(false);
  const [showVideoTools, setShowVideoTools] = useState(false);
  const [showTextTools, setShowTextTools] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [advancedSubPage, setAdvancedSubPage] = useState<'rag' | 'agent' | 'finetune'>('rag');
  const [textSubPage, setTextSubPage] = useState<'llm' | 'translate' | 'code_assist'>('llm');
  const [formatGroup, setFormatGroup] = useState<'media' | 'doc'>('media');
  const [hwAccelDetected, setHwAccelDetected] = useState('');

  const currentPage: Page = showHome ? 'home' : showTasks ? (tasksTab === 'tasks' ? 'tasks' : 'system') :
    showAudioTools ? 'audio_tools' : showFormatConvert ? 'format_convert' :
    showAdvancedTools ? (advancedSubPage === 'rag' ? 'rag' : advancedSubPage === 'agent' ? 'agent' : 'advanced_tools') :
    showImageTools ? 'image_tools' : showVideoTools ? 'video_tools' :
    showTextTools ? 'text_tools' : taskType;

  function navigate(page: Page, subPage?: string) {
    const resetAll = () => {
      setShowHome(false); setShowTasks(false);
      setShowAudioTools(false); setShowFormatConvert(false);
      setShowImageTools(false); setShowVideoTools(false); setShowTextTools(false);
      setShowAdvancedTools(false);
    };
    if (page === 'home') { resetAll(); setShowHome(true); }
    else if (page === 'tasks') { resetAll(); setShowTasks(true); setTasksTab('tasks'); fetchJobs(); }
    else if (page === 'system') { resetAll(); setShowTasks(true); setTasksTab(isDocker ? 'about' : 'models'); }
    else if (page === 'audio_tools') {
      resetAll(); setShowAudioTools(true);
      if (subPage && ['tts', 'vc', 'asr', 'voice_chat'].includes(subPage)) setTaskType(subPage as TaskType);
      else if (!AUDIO_TASK_TYPES.includes(taskType)) setTaskType('tts');
    }
    else if (page === 'format_convert') {
      resetAll(); setShowFormatConvert(true);
      if (!hwAccelDetected) {
        fetch(`${backendBaseUrl}/hw-accel`)
          .then(r => r.json())
          .then(d => setHwAccelDetected(d.label || ''))
          .catch(() => {});
      }
    }
    else if (page === 'image_tools') {
      resetAll(); setShowImageTools(true);
      if (subPage) setMiscSubPage(subPage as MiscSubPage);
      else setMiscSubPage('img_gen');
    }
    else if (page === 'video_tools') {
      resetAll(); setShowVideoTools(true);
      if (subPage) setMiscSubPage(subPage as MiscSubPage);
      else setMiscSubPage('video_gen');
    }
    else if (page === 'text_tools') {
      resetAll(); setShowTextTools(true);
      if (subPage === 'llm' || subPage === 'translate' || subPage === 'code_assist') {
        setTextSubPage(subPage);
        if (subPage !== 'llm') setMiscSubPage(subPage as MiscSubPage);
      }
    }
    else if (page === 'rag') {
      resetAll(); setShowAdvancedTools(true);
      setAdvancedSubPage('rag');
    }
    else if (page === 'agent') {
      resetAll(); setShowAdvancedTools(true);
      setAdvancedSubPage('agent');
    }
    else if (page === 'advanced_tools') {
      resetAll(); setShowAdvancedTools(true);
      if (subPage === 'rag' || subPage === 'agent' || subPage === 'finetune') {
        setAdvancedSubPage(subPage);
      } else {
        setAdvancedSubPage('finetune');
      }
    }
    else if (page === 'misc') {
      // backward compat: misc goes to image_tools
      resetAll(); setShowImageTools(true);
      if (subPage) setMiscSubPage(subPage as MiscSubPage);
    }
    else { resetAll(); setTaskType(page as TaskType); }
  }

  function navigateTasks() {
    setShowHome(false); setShowTasks(true); setTasksTab('tasks');
  }

  return {
    taskType, setTaskType,
    showHome, showTasks, showAudioTools, showFormatConvert,
    showImageTools, showVideoTools, showTextTools, showAdvancedTools,
    tasksTab, setTasksTab,
    advancedSubPage, setAdvancedSubPage,
    textSubPage, setTextSubPage,
    formatGroup, setFormatGroup,
    hwAccelDetected,
    currentPage,
    navigate, navigateTasks,
  };
}
