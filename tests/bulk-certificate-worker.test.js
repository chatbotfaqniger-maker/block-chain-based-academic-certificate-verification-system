import test from "node:test";
import assert from "node:assert/strict";
import {startBulkCertificateWorker,isTransientBulkCertificateError} from "../server/bulk-certificate-worker.js";

const waitFor=async(predicate,timeoutMs=1000)=>{
 const start=Date.now();
 while(Date.now()-start<timeoutMs){if(predicate())return;await new Promise(r=>setTimeout(r,5));}
 throw new Error("Timed out waiting for worker");
};

test("classifies common network and gateway failures as transient",()=>{
 assert.equal(isTransientBulkCertificateError({statusCode:503}),true);
 assert.equal(isTransientBulkCertificateError({code:"ECONNRESET"}),true);
 assert.equal(isTransientBulkCertificateError({statusCode:422}),false);
});

test("claims, processes and finalizes a certificate item",async()=>{
 let claims=0,finishArgs=null;
 const client={rpc:async(name,args)=>{
  if(name==="claim_next_certificate_issuance_item")return {data:++claims===1?{claimed:true,item:{id:"item-1",batchId:"batch-1"}}:{claimed:false},error:null};
  if(name==="finish_certificate_issuance_item"){finishArgs=args;return {data:{},error:null};}
  throw new Error("Unexpected RPC "+name);
 }};
 const stop=startBulkCertificateWorker({client,processItem:async()=>({status:"ISSUED",certificateId:"VRT-TEST-1"}),pollIntervalMs:10000,reconcileIntervalMs:10000,logger:{}});
 await waitFor(()=>finishArgs);
 await stop();
 assert.equal(finishArgs.p_item_id,"item-1");
 assert.equal(finishArgs.p_status,"ISSUED");
 assert.equal(finishArgs.p_certificate_id,"VRT-TEST-1");
});

test("requeues transient document failure without losing the certificate id",async()=>{
 let claims=0,finishArgs=null;
 const client={rpc:async(name,args)=>{
  if(name==="claim_next_certificate_issuance_item")return {data:++claims===1?{claimed:true,item:{id:"item-2",certificateId:"VRT-TEST-2"}}:{claimed:false},error:null};
  if(name==="finish_certificate_issuance_item"){finishArgs=args;return {data:{},error:null};}
  throw new Error("Unexpected RPC "+name);
 }};
 const error=Object.assign(new Error("Storage temporarily unavailable"),{statusCode:503,certificateId:"VRT-TEST-2"});
 const stop=startBulkCertificateWorker({client,processItem:async()=>{throw error;},pollIntervalMs:10000,reconcileIntervalMs:10000,logger:{}});
 await waitFor(()=>finishArgs);
 await stop();
 assert.equal(finishArgs.p_status,"RETRY");
 assert.equal(finishArgs.p_certificate_id,"VRT-TEST-2");
});

test("marks permanent pre-issuance failures as failed",async()=>{
 let claims=0,finishArgs=null;
 const client={rpc:async(name,args)=>{
  if(name==="claim_next_certificate_issuance_item")return {data:++claims===1?{claimed:true,item:{id:"item-3"}}:{claimed:false},error:null};
  if(name==="finish_certificate_issuance_item"){finishArgs=args;return {data:{},error:null};}
  throw new Error("Unexpected RPC "+name);
 }};
 const stop=startBulkCertificateWorker({client,processItem:async()=>{throw Object.assign(new Error("Invalid certificate data"),{permanent:true});},pollIntervalMs:10000,reconcileIntervalMs:10000,logger:{}});
 await waitFor(()=>finishArgs);
 await stop();
 assert.equal(finishArgs.p_status,"FAILED");
 assert.equal(finishArgs.p_certificate_id,null);
});

test("runs expired-item reconciliation before claiming work",async()=>{
 let reconciled=0,claims=0;
 const client={rpc:async(name)=>{if(name==="claim_next_certificate_issuance_item")return {data:{claimed:false},error:null};throw new Error("Unexpected RPC "+name);}};
 const stop=startBulkCertificateWorker({client,processItem:async()=>({status:"ISSUED"}),reconcilePending:async()=>{reconciled++;},pollIntervalMs:10000,reconcileIntervalMs:10000,logger:{}});
 await waitFor(()=>claims>0||reconciled>0);
 await stop();
 assert.equal(reconciled,1);
});
