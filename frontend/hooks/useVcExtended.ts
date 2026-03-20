import { useState } from 'react';
import type { VcInputMode } from '../types';

export function useVcExtended() {
  const [vcInputMode, setVcInputMode] = useState<VcInputMode>('upload');
  const [vcFile, setVcFile] = useState<File | null>(null);
  const [vcRefAudios, setVcRefAudios] = useState<File[]>([]);
  const [seedVcDiffusionSteps, setSeedVcDiffusionSteps] = useState(8);
  const [seedVcPitchShift, setSeedVcPitchShift] = useState(0);
  const [seedVcF0Condition, setSeedVcF0Condition] = useState(false);
  const [seedVcEnablePostprocess, setSeedVcEnablePostprocess] = useState(true);
  const [seedVcCfgRate, setSeedVcCfgRate] = useState(0.7);
  const [rvcF0Method, setRvcF0Method] = useState('rmvpe');
  const [rvcFilterRadius, setRvcFilterRadius] = useState(3);
  const [rvcIndexRate, setRvcIndexRate] = useState(0.75);
  const [rvcPitchShift, setRvcPitchShift] = useState(0);
  const [rvcRmsMixRate, setRvcRmsMixRate] = useState(0.25);
  const [rvcProtect, setRvcProtect] = useState(0.33);

  return {
    vcInputMode, setVcInputMode,
    vcFile, setVcFile,
    vcRefAudios, setVcRefAudios,
    seedVcDiffusionSteps, setSeedVcDiffusionSteps,
    seedVcPitchShift, setSeedVcPitchShift,
    seedVcF0Condition, setSeedVcF0Condition,
    seedVcEnablePostprocess, setSeedVcEnablePostprocess,
    seedVcCfgRate, setSeedVcCfgRate,
    rvcF0Method, setRvcF0Method,
    rvcFilterRadius, setRvcFilterRadius,
    rvcIndexRate, setRvcIndexRate,
    rvcPitchShift, setRvcPitchShift,
    rvcRmsMixRate, setRvcRmsMixRate,
    rvcProtect, setRvcProtect,
  };
}
