import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const clean = (value, fallback = "—", max = 78) => {
  const text = String(value ?? "").replace(/[\\r\\n\\t]+/g, " ").replace(/[^\\p{L}\\p{N} .,:;()/_+&-]/gu, "").trim();
  return (text || fallback).slice(0, max);
};
const mask = value => {
  const text = String(value || "");
  if (text.length < 12) return text ? text.slice(0, 4) + "••••" : "Reference unavailable";
  return text.slice(0, 8) + "••••••••" + text.slice(-4);
};
function run(args) {
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    process.stderr.on("data", chunk => error += chunk.toString());
    process.on("error", reject);
    process.on("close", code => code === 0 ? resolve() : reject(new Error(error.slice(-3000) || "MP4 rendering failed.")));
  });
}

export async function createVerityMarketingMp4({ stats = {}, certificate = null, auditEvents = [], chain = {}, verification = null } = {}) {
  const duration = 90;
  const institution = clean(certificate?.institution, "Approved academic institution");
  const qualification = clean(certificate?.qualification, "Academic qualification");
  const certificateId = mask(certificate?.certificateId);
  const verificationKey = mask(certificate?.verificationKey);
  const status = verification?.verified ? "VERIFIED · LIVE REGISTRY CHECK" : clean(verification?.status, "LIVE CHECK NOT AVAILABLE");
  const audit = auditEvents[0] ? clean(String(auditEvents[0].action || "Platform activity").replaceAll("_", " "), "Platform activity") : "Audit events appear here as platform actions occur";
  const chainLabel = chain?.enabled ? "EVM NETWORK CONNECTED" : "DATABASE LEDGER MODE · NO ON-CHAIN CLAIM";
  const scenes = [
    ["VERITY · DIGITAL CREDENTIAL NETWORK","Trust every credential.","A connected platform for issuing, sharing and verifying academic achievements.","THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION","VERITY / INTRO",["Issue with confidence","Share with control","Verify with evidence",""]],
    ["01 / LIVE PLATFORM OVERVIEW","One network. Four workspaces.","Live platform totals and credential activity, loaded from the authenticated Verity database.","REAL PLATFORM DATA · REFRESHED AT EXPORT","LIVE DASHBOARD",[ "Total credentials  " + (stats.total ?? 0), "Active credentials  " + (stats.active ?? 0), "Revoked credentials  " + (stats.revoked ?? 0), "Verifications  " + (stats.verifications ?? 0) ]],
    ["02 / INSTITUTION WORKSPACE","From student record to issued award.","An approved institution reviews the graduate and award details before registering the certificate.","INSTITUTION-APPROVED ISSUANCE WORKFLOW","ISSUE CERTIFICATE",[institution, qualification, "Record status  " + clean(certificate?.status, "No live record"), "Award date  " + clean(certificate?.awardDate, "—")]],
    ["03 / VERIFICATION CODE","A unique reference is created.","Verity generates a certificate ID and a separate verification key for QR and reference-based checks.","REAL REFERENCE · MASKED FOR STUDENT PRIVACY","ISSUANCE REFERENCE",[ "Certificate ID  " + certificateId, "Verification key  " + verificationKey, "Fingerprint  " + clean(certificate?.digest ? String(certificate.digest).slice(0, 18) + "…" : "", "Created at issuance"), "QR / verification link  Ready to share" ]],
    ["04 / GRADUATE WORKSPACE","The achievement belongs to the graduate.","Linked graduates can access their credentials and retrieve the verification reference issued by their institution.","PERSONAL CREDENTIAL ACCESS","MY CREDENTIALS",[qualification, institution, "Credential status  " + clean(certificate?.status, "—"), "Graduate account  " + (certificate?.graduateId ? "Linked" : "Not linked to a graduate account")]],
    ["05 / SECURE SHARING","Share proof. Protect the original.","Graduates can share a verification link or key. Access to private original documents remains subject to graduate consent.","VERIFICATION LINK · CONSENT-BASED DOCUMENT ACCESS","SHARE CREDENTIAL",[ "Verification reference  " + verificationKey, "Public status check  Available", "Original document  Consent required", "Private access  Time-limited" ]],
    ["06 / ORGANIZATION WORKSPACE","Verify against the issuer's record.","A real reference lookup and integrity check was performed against a current Verity credential before this film was rendered.","LIVE REGISTRY LOOKUP · ACTUAL VERIFICATION RESPONSE","ORGANIZATION VERIFICATION",[ "Submitted reference  " + verificationKey, "Registry response  " + status, "Credential  " + qualification, "Issuer  " + institution ]],
    ["07 / ADMINISTRATION","Oversight at every step.","Administrators review organization approvals, credential activity and audit events across the platform.","PLATFORM MANAGEMENT · AUDIT ACTIVITY","ADMIN CONTROL CENTRE",[ "Credential records  " + (stats.total ?? 0), "Verification activity  " + (stats.verifications ?? 0), "Latest audit event  " + audit, "Network status  " + chainLabel ]],
    ["VERITY · TRUST, PROVEN","Achievement deserves proof.","Issue responsibly. Share securely. Verify with confidence. One connected credential journey.","VERITY · THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION","THE CREDENTIAL JOURNEY",[ "INSTITUTION  →  ISSUE", "VERITY  →  GENERATE REFERENCE", "GRADUATE  →  SHARE", "ORGANIZATION  →  VERIFY" ]]
  ];

  const dir = await mkdtemp(path.join(os.tmpdir(), "verity-marketing-"));
  try {
    const filters = [
      "drawbox=x='mod(t*110,1500)-220':y=0:w=220:h=720:color=0x20b9aa@0.08:t=fill",
      "drawbox=x=690:y=104:w=520:h=520:color=0x102b38@0.96:t=fill",
      "drawbox=x=690:y=104:w=520:h=520:color=0x31515d@0.95:t=2",
      "drawbox=x=690:y=104:w=520:h=48:color=0x173744@1:t=fill",
      "drawbox=x=72:y=650:w=1136:h=2:color=0x31515d@1:t=fill",
      "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='VERITY':fontcolor=white:fontsize=30:x=115:y=55",
      "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='THE FUTURE OF DIGITAL CREDENTIAL VERIFICATION':fontcolor=0x75939b:fontsize=14:x=72:y=680"
    ];
    for (let i = 0; i < scenes.length; i++) {
      const start = i * 10;
      const end = start + 10;
      const files = [];
      for (let j = 0; j < 8; j++) {
        const file = path.join(dir, "scene-" + i + "-" + j + ".txt");
        await writeFile(file, clean(scenes[i][j] || "", " ", 112), "utf8");
        files.push(file);
      }
      const add = (file, size, color, x, y) => filters.push(
        "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:textfile=" + file +
        ":expansion=none:fontcolor=" + color + ":fontsize=" + size + ":x=" + x + ":y=" + y +
        ":enable='between(t," + start + "," + end + ")':alpha='if(lt(t," + (start + 0.55) + "),(t-" + start + ")/0.55,if(gt(t," + (end - 0.55) + "),(" + end + "-t)/0.55,1))'"
      );
      add(files[0], 16, "0x69daca", 72, 190);
      add(files[1], 46, "white", 72, 252);
      add(files[2], 21, "0xb5cbd0", 72, 330);
      add(files[3], 14, "0x82aeb6", 72, 414);
      add(files[4], 15, "0x9dded5", 724, 174);
      for (let j = 0; j < 4; j++) add(files[5 + j], 15, "white", 724, 238 + j * 76);
      filters.push("drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf:text='0" + (i + 1) + " / 09':fontcolor=0x75939b:fontsize=14:x=1140:y=680:enable='between(t," + start + "," + end + ")'");
    }

    const output = path.join(dir, "VERITY-Marketing-Showcase.mp4");
    const args = ["-y", "-f", "lavfi", "-i", "color=c=0x071722:s=1280x720:r=30:d=" + duration];
    for (const frequency of [55, 110, 164.81, 220, 329.63, 440]) {
      args.push("-f", "lavfi", "-t", String(duration), "-i", "sine=frequency=" + frequency + ":sample_rate=44100");
    }
    args.push(
      "-filter_complex",
      "[1:a]volume=0.16,lowpass=f=180[bass];" +
      "[2:a]volume=0.075,lowpass=f=500[lowpad];" +
      "[3:a]volume=0.065,lowpass=f=700[midpad];" +
      "[4:a]volume=0.055,lowpass=f=1100[highpad];" +
      "[5:a]volume=0.028,lowpass=f=1800[shimmer];" +
      "[6:a]volume=0.018,highpass=f=1800,lowpass=f=6500[air];" +
      "[bass][lowpad][midpad][highpad][shimmer][air]amix=inputs=6:duration=longest:normalize=0,afade=t=in:st=0:d=4,afade=t=out:st=84:d=6,alimiter=limit=0.88[aout]",
      "-map", "0:v", "-map", "[aout]", "-vf", filters.join(","), "-t", String(duration), "-r", "30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", output
    );
    await run(args);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
