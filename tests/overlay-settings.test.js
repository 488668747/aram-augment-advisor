import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_REGIONS, validateRegions, loadOverlaySettings, saveOverlaySettings } from '../src/main/overlay-settings.js';

test('校准坐标必须在屏幕内且按左中右排列',()=>{
  assert.equal(validateRegions(DEFAULT_REGIONS).length,3);
  assert.throws(()=>validateRegions([{x:-.1,y:0,width:.2,height:.1},...DEFAULT_REGIONS.slice(1)]));
  assert.throws(()=>validateRegions([...DEFAULT_REGIONS].reverse()));
  assert.throws(()=>validateRegions([{x:0,y:0,width:NaN,height:.1},...DEFAULT_REGIONS.slice(1)]));
});

test('用户校准和识别开关可离线保存与恢复',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'aram-overlay-settings-'));
  try{
    const file=path.join(root,'settings.json');
    assert.equal((await loadOverlaySettings(file)).enabled,true);
    await saveOverlaySettings(file,{enabled:false,displayId:'123',regions:DEFAULT_REGIONS,calibrated:true});
    const restored=await loadOverlaySettings(file);
    assert.equal(restored.enabled,false);assert.equal(restored.displayId,'123');assert.equal(restored.calibrated,true);
  }finally{await rm(root,{recursive:true,force:true});}
});
