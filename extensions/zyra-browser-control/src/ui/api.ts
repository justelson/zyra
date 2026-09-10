import { useEffect, useState } from 'react';
import type { ExtensionState } from '../shared/protocol';
export async function request<T=ExtensionState>(type:string,params:Record<string,unknown>={}):Promise<T>{
  if(type==='connect' && !await chrome.permissions.request({origins:['http://127.0.0.1/*']}))throw new Error('Allow a local connection to the Zyra app to continue.');
  const response=await chrome.runtime.sendMessage({type,...params});
  if(!response?.ok)throw new Error(response?.error?.message||'The extension worker is unavailable. Reload the extension.');
  return response.result;
}
export function useExtension(){
  const [state,setState]=useState<ExtensionState|null>(null),[error,setError]=useState(''),[dismissed,setDismissed]=useState<string|null>(null),[busy,setBusy]=useState('');
  useEffect(()=>{
    let disposed=false,port:chrome.runtime.Port|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    const receive=(next:ExtensionState)=>{if(!disposed)setState(next);};
    const connect=()=>{
      if(disposed)return;
      try{
        port=chrome.runtime.connect({name:'zyra-ui'});
        port.onMessage.addListener(receive);
        port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!disposed)timer=setTimeout(connect,1000);});
        void request('status').then(receive).catch(e=>{if(!disposed)setError((e as Error).message);});
      }catch(e){setError((e as Error).message);}
    };
    connect();return()=>{disposed=true;clearTimeout(timer);port?.disconnect();};
  },[]);
  const action=async(type:string,params:Record<string,unknown>={})=>{
    setError('');setDismissed(null);setBusy(type);
    try{await request(type,params);return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy('');}
  };
  return {state,error:error||(state?.lastError!==dismissed?state?.lastError:null),busy,action,clearError:()=>{setError('');setDismissed(state?.lastError??null);}};
}
