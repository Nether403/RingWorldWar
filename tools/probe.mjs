import { chromium } from "playwright";
const b = await chromium.launch({ headless: false, args: ["--use-angle=d3d11"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
p.on("pageerror", e => console.log("ERR", e.message));
await p.goto("http://localhost:5180/?quality=high", { waitUntil: "load" });
await p.waitForFunction(() => !!window.RWW, null, { timeout: 90000 });
await p.bringToFront();
await p.waitForTimeout(5000);

async function lum(tag) {
  const raw = await p.screenshot({ timeout: 60000 });
  const v = await p.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(330, 260, 440, 260).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]+d[i+1]+d[i+2];
    return s/(d.length/4)/3;
  }, Array.from(raw));
  console.log(tag.padEnd(30), "lum", v.toFixed(1));
}
const setFrag = (src) => p.evaluate((s) => {
  const c = window.RWW.renderer.composer;
  const g = c.passes.find(x => x.material && x.material.name === "RwwGradeShader");
  g.material.fragmentShader = s;
  g.material.needsUpdate = true;
}, src);

const HEAD = "uniform sampler2D tDiffuse; varying vec2 vUv;";
await lum("current grade");
await setFrag(HEAD + " void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }");
await p.waitForTimeout(1400); await lum("passthrough");
await setFrag(HEAD + " void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; c = max(c,0.0); c = mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(vec3(0.0031308), c)); gl_FragColor = vec4(c,1.0); }");
await p.waitForTimeout(1400); await lum("passthrough + sRGB");
await setFrag(HEAD + " void main(){ gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }");
await p.waitForTimeout(1400); await lum("solid magenta");
await b.close();
