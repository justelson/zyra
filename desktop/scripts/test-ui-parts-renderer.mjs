import { execSync } from 'node:child_process'
import { desktopRoot, hiddenRendererBenchmark } from './helpers/hidden-renderer-benchmark.mjs'
const snapshot = JSON.parse(execSync('bun scripts/agent-ui-snapshot.ts',{cwd:desktopRoot,encoding:'utf8'}))
const result = await hiddenRendererBenchmark({name:'ui-parts',entry:'scripts/fixtures/ui-parts.tsx',plugins:[{name:'isolated-device-settings',setup(api){api.onLoad({filter:/[\\/]lib[\\/]settings\.tsx$/},()=>({loader:'tsx',resolveDir:desktopRoot,contents:`import {useState} from 'react'; export function useSettings(){const [settings,set]=useState({appearanceUiParts:${JSON.stringify(snapshot)},accessibilityReduceMotion:false}); return {settings,updateSettings:async patch=>set({...settings,...patch})}}`}))}}]})
console.log(result.result)
