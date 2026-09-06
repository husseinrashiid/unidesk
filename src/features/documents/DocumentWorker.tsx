import {useEffect} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {indexTick} from './indexer';
export function DocumentWorker(){
 const client=useQueryClient();
 useEffect(()=>{
  let stopped=false;let timer:ReturnType<typeof setTimeout>;
  const refresh=()=>{void client.invalidateQueries({queryKey:['documents']});void client.invalidateQueries({queryKey:['document-chunks']});void client.invalidateQueries({queryKey:['material-search']});};
  const run=async()=>{try{if(await indexTick())refresh();}catch{/* A local index failure must not break the workspace. Individual jobs retain their error. */}finally{if(!stopped)timer=setTimeout(()=>void run(),2000);}};
  timer=setTimeout(()=>void run(),1500);window.addEventListener('unidesk:document-index',refresh);
  return ()=>{stopped=true;clearTimeout(timer);window.removeEventListener('unidesk:document-index',refresh);};
 },[client]);
 return null;
}
