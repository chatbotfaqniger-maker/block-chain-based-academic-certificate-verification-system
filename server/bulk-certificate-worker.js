import { randomUUID } from "node:crypto";

export function isTransientBulkCertificateError(error) {
  const code=String(error?.code||"").toUpperCase();
  const status=Number(error?.statusCode||error?.status||error?.response?.status||0);
  return [408,425,429,500,502,503,504].includes(status)
    || ["ETIMEDOUT","ECONNRESET","ECONNREFUSED","EAI_AGAIN","UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET"].includes(code)
    || error?.transient===true
    || /timeout|network|temporarily unavailable|fetch failed|connection reset|socket hang up/i.test(String(error?.message||""));
}

export function startBulkCertificateWorker({
  client,
  processItem,
  reconcilePending=async()=>{},
  logger=console,
  pollIntervalMs=5000,
  reconcileIntervalMs=30000,
  maxBackoffMs=30000
}) {
  if(!client?.rpc||typeof processItem!=="function")throw new Error("A Supabase client and processItem callback are required");
  let stopped=false;
  let wakeSleep=null;
  let timer=null;

  const sleep=(ms)=>new Promise(resolve=>{
    timer=setTimeout(()=>{timer=null;wakeSleep=null;resolve();},ms);
    wakeSleep=()=>{if(timer)clearTimeout(timer);timer=null;wakeSleep=null;resolve();};
  });

  const finish=async(item,leaseToken,result)=>{
    const {error}=await client.rpc("finish_certificate_issuance_item",{
      p_item_id:item.id,
      p_lease_token:leaseToken,
      p_status:result.status,
      p_certificate_id:result.certificateId??item.certificateId??null,
      p_error_code:result.errorCode??null,
      p_error_message:result.errorMessage??null
    });
    if(error)throw error;
  };

  const loop=(async()=>{
    let backoff=1000;
    let nextReconcileAt=0;
    while(!stopped){
      try{
        if(Date.now()>=nextReconcileAt){
          await reconcilePending();
          nextReconcileAt=Date.now()+reconcileIntervalMs;
        }
        const leaseToken=randomUUID();
        const {data,error}=await client.rpc("claim_next_certificate_issuance_item",{p_lease_token:leaseToken});
        if(error)throw error;
        if(!data?.claimed){
          backoff=1000;
          await sleep(pollIntervalMs);
          continue;
        }
        const item=data.item;
        try{
          const result=await processItem(item);
          await finish(item,leaseToken,{status:result?.status||"ISSUED",certificateId:result?.certificateId,errorCode:result?.errorCode,errorMessage:result?.errorMessage});
          logger.info?.("Bulk certificate issuance item finished",{itemId:item.id,status:result?.status||"ISSUED"});
        }catch(processError){
          const certificateId=processError?.certificateId||item.certificateId||null;
          const status=isTransientBulkCertificateError(processError)
            ?"RETRY"
            :certificateId?"ISSUED_DOCUMENT_FAILED":"FAILED";
          try{
            await finish(item,leaseToken,{
              status,
              certificateId,
              errorCode:processError?.code||"BULK_ISSUANCE_ERROR",
              errorMessage:String(processError?.message||"Bulk issuance failed").slice(0,500)
            });
          }catch(finishError){
            logger.error?.("Could not finalize bulk certificate issuance item",{itemId:item.id,error:finishError?.message||String(finishError)});
          }
          logger.error?.("Bulk certificate issuance item failed",{itemId:item.id,status,error:processError?.message||String(processError)});
        }
        backoff=1000;
      }catch(error){
        logger.error?.("Bulk certificate issuance worker loop failed",{error:error?.message||String(error)});
        await sleep(backoff);
        backoff=Math.min(maxBackoffMs,backoff*2);
      }
    }
  })();

  const stop=async()=>{
    stopped=true;
    wakeSleep?.();
    await loop;
  };
  stop.done=loop;
  return stop;
}
