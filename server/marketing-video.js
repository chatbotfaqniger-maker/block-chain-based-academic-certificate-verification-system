import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const scenes = [
 ["THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION","Trust every credential.","A smarter standard for issuing, sharing and verifying academic achievements.","VERITY · TRUST, PROVEN"],
 ["ONE CONNECTED CREDENTIAL NETWORK","Everything works together.","A unified workspace for institutions, graduates, employers and administrators.","ONE NETWORK · FOUR WORKSPACES"],
 ["INSTITUTION WORKSPACE","Issue with confidence.","Register learners, review academic records and issue credentials with a unique verification fingerprint.","REGISTER · REVIEW · ISSUE"],
 ["GRADUATE WORKSPACE","Your achievements. In your hands.","Access your credentials and share trusted verification details with control and consent.","OWN · SHARE · SUCCEED"],
 ["ORGANIZATION WORKSPACE","Verify before you decide.","Check credentials against the issuing institution's registered record.","LOOK UP · VALIDATE · TRUST"],
 ["ADMINISTRATION","Oversight at every step.","Manage organizations, monitor audit activity and maintain platform integrity.","MANAGE · MONITOR · PROTECT"],
 ["CREDENTIAL INTEGRITY","Proof that can be checked.","Credential references are checked against registered records and revocation status.","AUTHENTIC · TRACEABLE · VERIFIABLE"],
 ["VERITY","Achievement deserves proof.","Issue responsibly. Share securely. Verify with confidence.","THE TRUST NETWORK"]
];
function run(args) {
 return new Promise((resolve,reject)=>{
  const p=spawn("ffmpeg",args,{stdio:["ignore","ignore","pipe"]}); let err="";
  p.stderr.on("data",d=>err+=d.toString()); p.on("error",reject);
  p.on("close",code=>code===0?resolve():reject(new Error(err.slice(-3000)||"MP4 rendering failed.")));
 });
}
export async function createVerityMarketingMp4() {
 const dir=await mkdtemp(path.join(os.tmpdir(),"verity-marketing-"));
 try {
  const filters=["drawbox=x='mod(t*95,1500)-180':y=0:w=190:h=720:color=0x20b9aa@0.07:t=fill",
   "drawbox=x=680:y=105:w=520:h=490:color=0x102b38@0.94:t=fill",
   "drawbox=x=680:y=105:w=520:h=490:color=0x31515d@0.95:t=3",
   "drawbox=x=72:y=650:w=1136:h=2:color=0x31515d@1:t=fill",
   "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='VERITY':fontcolor=white:fontsize=30:x=115:y=65",
   "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION':fontcolor=0x75939b:fontsize=14:x=72:y=680"];
  for(let i=0;i<scenes.length;i++){
   const start=(i*7.25).toFixed(2),end=((i+1)*7.25).toFixed(2);
   const files=[];
   for(let j=0;j<4;j++){const f=path.join(dir,"s"+i+"-"+j+".txt");await writeFile(f,scenes[i][j],"utf8");files.push(f);}
   const add=(file,size,color,x,y)=>filters.push("drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:textfile="+file+":fontcolor="+color+":fontsize="+size+":x="+x+":y="+y+":enable='between(t,"+start+","+end+")':alpha='if(lt(t,"+(i*7.25+0.45)+"),(t-"+(i*7.25)+")/0.45,if(gt(t,"+(i*7.25+6.8)+"),("+end+"-t)/0.45,1))'");
   add(files[0],17,"0x69daca",72,190);
   add(files[1],49,"white",72,260);
   add(files[2],22,"0xb5cbd0",72,330);
   add(files[3],15,"0x82aeb6",72,420);
   filters.push("drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='0"+(i+1)+" / 08':fontcolor=0x75939b:fontsize=14:x=1140:y=680:enable='between(t,"+start+","+end+")'");
  }
  const output=path.join(dir,"VERITY-Marketing-Showcase.mp4");
  const args=["-y","-f","lavfi","-i","color=c=0x071722:s=1280x720:r=30:d=58"];
  for (const frequency of [55,110,164.81,220,329.63,440]) {
   args.push("-f","lavfi","-t","58","-i","sine=frequency="+frequency+":sample_rate=44100");
  }
  args.push("-filter_complex",
   "[1:a]volume=0.16,lowpass=f=180[bass];"+
   "[2:a]volume=0.075,lowpass=f=500[lowpad];"+
   "[3:a]volume=0.065,lowpass=f=700[midpad];"+
   "[4:a]volume=0.055,lowpass=f=1100[highpad];"+
   "[5:a]volume=0.028,lowpass=f=1800[shimmer];"+
   "[6:a]volume=0.018,highpass=f=1800,lowpass=f=6500[air];"+
   "[bass][lowpad][midpad][highpad][shimmer][air]amix=inputs=6:duration=longest:normalize=0,afade=t=in:st=0:d=3,afade=t=out:st=54:d=4,alimiter=limit=0.88[aout]",
   "-map","0:v","-map","[aout]","-vf",filters.join(","),"-t","58","-r","30",
   "-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p",
   "-c:a","aac","-b:a","192k","-ar","44100","-movflags","+faststart",output);
  await run(args);
  return await readFile(output);
 } finally { await rm(dir,{recursive:true,force:true}); }
}
