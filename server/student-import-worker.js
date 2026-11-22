export function startStudentImportWorker({client,logger=console,pollIntervalMs=1500,maxBackoffMs=15000}={}){
 if(!client)throw new Error("A privileged Supabase server client is required for the student import worker.");
 let stopping=false,timer=null,wakeSleep=null,resolveDone;
 const done=new Promise(resolve=>{resolveDone=resolve;});
 const sleep=ms=>new Promise(resolve=>{
  timer=setTimeout(()=>{timer=null;wakeSleep=null;resolve();},ms);
  wakeSleep=()=>{if(timer)clearTimeout(timer);timer=null;wakeSleep=null;resolve();};
 });
 async function loop(){
  let failures=0;
  try{
   while(!stopping){
    try{
     const {data,error}=await client.rpc("process_next_student_import_chunk");
     if(error)throw error;
     failures=0;
     if(data?.processed){
      if(data.failed){
       logger.error?.("[VERITY import worker] chunk failed",{batchId:data.batchId,chunkIndex:data.chunkIndex,error:data.error});
      }else{
       logger.info?.("[VERITY import worker] processed batch chunk",{
        batchId:data.batchId,chunkIndex:data.chunkIndex,inserted:data.inserted,duplicates:data.duplicates,status:data.status
       });
      }
      continue;
     }
     await sleep(pollIntervalMs);
    }catch(error){
     failures=Math.min(failures+1,5);
     logger.error?.("[VERITY import worker] queue poll failed:",error?.message||error);
     await sleep(Math.min(maxBackoffMs,pollIntervalMs*(2**failures)));
    }
   }
  }finally{resolveDone();}
 }
 loop().catch(error=>logger.error?.("[VERITY import worker] stopped unexpectedly:",error?.message||error));
 return async function stopStudentImportWorker(){
  stopping=true;
  wakeSleep?.();
  await done;
 };
}
