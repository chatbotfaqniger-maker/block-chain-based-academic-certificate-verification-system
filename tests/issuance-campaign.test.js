import test from "node:test";
import assert from "node:assert/strict";
import {MAX_CAMPAIGN_ITEMS,MAX_MONTHLY_ISSUANCE_ITEMS,MAX_LEGACY_CAMPAIGN_ITEMS,PROCESSING_BATCH_SIZE,getIssuanceChunk} from "../src/issuance-campaign.js";

test("campaign chunks keep the durable worker unit at 500",()=>{
  const items=Array.from({length:501},(_,i)=>i);
  const first=getIssuanceChunk(items,0),second=getIssuanceChunk(items,500);
  assert.equal(first.items.length,500);assert.equal(first.partNumber,1);assert.equal(first.totalParts,2);
  assert.equal(second.items.length,1);assert.equal(second.start,500);assert.equal(second.items[0],500);
  assert.equal(PROCESSING_BATCH_SIZE,500);
});

test("campaign planner handles monthly allowance and chunk boundaries",()=>{
  for(const size of [1,499,500,1000,1001,7999,8000]){
    const items=Array.from({length:size},(_,i)=>i);let offset=0,total=0,parts=0;
    while(offset<size){const chunk=getIssuanceChunk(items,offset);assert.ok(chunk.items.length>0&&chunk.items.length<=500);assert.equal(chunk.start,offset);total+=chunk.items.length;offset=chunk.end;parts++;}
    assert.equal(total,size);assert.equal(parts,Math.ceil(size/500));
  }
  assert.equal(MAX_CAMPAIGN_ITEMS,8000);assert.equal(MAX_MONTHLY_ISSUANCE_ITEMS,8000);
});

test("campaign planner rejects sizes above the 8,000-record boundary",()=>{
  assert.equal(getIssuanceChunk(new Array(8001),0).items.length,500);
  assert.equal(getIssuanceChunk(new Array(50000),0).totalParts,100);
  assert.throws(()=>getIssuanceChunk(new Array(MAX_LEGACY_CAMPAIGN_ITEMS+1),0),/50,000/);
  assert.throws(()=>getIssuanceChunk([1,2],2),/offset/);assert.throws(()=>getIssuanceChunk([1,2],-1),/offset/);
});
