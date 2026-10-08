import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {test} from "node:test";

const source = fs.readFileSync(new URL("../server.js",import.meta.url),"utf8");
const worker = source.slice(source.indexOf("const SCHEDULED_PUBLISHER_ENABLED ="));
export function publisherHarness(value, publish = async()=>{}) {
  const intervals=[];let startup,errors=0;
  const ctx=vm.createContext({process:{env:value === undefined ? {} : {SCHEDULED_PUBLISHER_ENABLED:value}},
    USE_SUPABASE_PERSISTENCE:true,supabasePersistence:{publishDueReleases:publish},PORT:0,
    app:{listen:(port,host,fn)=>{startup=fn;}},console:{log(){},error(){errors++;}},
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return {unref(){}};},
  });
  vm.runInContext(worker,ctx);
  return {ctx,intervals,startup,errors:()=>errors};
}

for(const [name,value] of [["missing",undefined],["empty",""],["false","false"],["whitespace"," "],["malformed","yes"],["numeric","1"],["case-invalid","TRUE"],["padded"," true "],["boolean",true]]){
  test(`publisher flag ${name}: starts normally, no timer, no startup or direct publication`,async()=>{
    let calls=0;const h=publisherHarness(value,async()=>{calls++;});h.startup();await h.ctx.runScheduledPublication();
    assert.equal(h.intervals.length,0);assert.equal(calls,0);assert.equal(h.errors(),0);
  });
}
test("exact true enables startup and 60-second ticks with overlap guard and safe retry",async()=>{
  let calls=0,finish;
  const h=publisherHarness("true",()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  assert.equal(h.intervals.length,1);assert.equal(h.intervals[0].ms,60000);
  h.startup();await h.ctx.runScheduledPublication();assert.equal(calls,1);finish();await new Promise(resolve=>setImmediate(resolve));
  const tick=h.intervals[0].fn();assert.equal(calls,2);finish();await tick;
  h.ctx.supabasePersistence.publishDueReleases=async()=>{throw new Error("synthetic private failure");};await h.ctx.runScheduledPublication();assert.equal(h.errors(),1);
  h.ctx.supabasePersistence.publishDueReleases=async()=>{calls++;};await h.ctx.runScheduledPublication();assert.equal(calls,3);
});
