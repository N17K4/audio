import { useState } from 'react';
import type { TaskType, MiscSubPage } from '../types';
import type { Page } from '../components/layout/Sidebar';

const AUDIO_TASK_TYPES: TaskType[] = ['tts', 'vc'];

interface UseNavigationParams {
  backendBaseUrl: string;
  setMiscSubPage: (page: MiscSubPage) => void;
  fetchJobs: () => void;
  isDocker?: boolean;
}

export function useNavigation({ setMiscSubPage, fetchJobs, isDocker }: UseNavigationParams) {
  const [taskType, setTaskType] = useState<TaskType>('vc');
  const [showHome, setShowHome] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [tasksTab, setTasksTab] = useState<'tasks' | 'models'>('tasks');
  const [showAudioTools, setShowAudioTools] = useState(true);
  const [showImageTools, setShowImageTools] = useState(false);
  const [showVideoTools, setShowVideoTools] = useState(false);
  const [showFormatConvert, setShowFormatConvert] = useState(false);

  const currentPage: Page = showHome ? 'home' : showTasks ? (tasksTab === 'tasks' ? 'tasks' : 'system') :
    showAudioTools ? 'audio_tools' :
    showImageTools ? 'image_tools' : showVideoTools ? 'video_tools' :
    showFormatConvert ? 'format_convert' : taskType;

  function navigate(page: Page, subPage?: string) {
    const resetAll = () => {
      setShowHome(false); setShowTasks(false);
      setShowAudioTools(false);
      setShowImageTools(false); setShowVideoTools(false); setShowFormatConvert(false);
    };
    if (page === 'home') { resetAll(); setShowAudioTools(true); }
    else if (page === 'tasks') { resetAll(); setShowTasks(true); setTasksTab('tasks'); fetchJobs(); }
    else if (page === 'system') { resetAll(); setShowTasks(true); setTasksTab('models'); }
    else if (page === 'audio_tools') {
      resetAll(); setShowAudioTools(true);
      if (subPage && ['tts', 'vc'].includes(subPage)) setTaskType(subPage as TaskType);
      else if (!AUDIO_TASK_TYPES.includes(taskType)) setTaskType('tts');
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
    else if (page === 'format_convert') {
      resetAll(); setShowFormatConvert(true);
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
    showHome, showTasks, showAudioTools,
    showImageTools, showVideoTools, showFormatConvert,
    tasksTab, setTasksTab,
    currentPage,
    navigate, navigateTasks,
  };
}
