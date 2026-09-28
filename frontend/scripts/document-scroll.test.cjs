// Isolated browser regression for the document scrolling contract, not live CRM QA.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

async function main() {
  const browser = process.env.SCROLL_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  assert.ok(fs.existsSync(browser), 'Set SCROLL_TEST_BROWSER to a Chromium browser executable');
  const source = fs.readFileSync(path.join(__dirname, '../src/app/globals.css'), 'utf8');
  // Use the real base rules; omit remote fonts and unrelated component utilities.
  const base = source.slice(source.indexOf('@layer base'), source.indexOf('@layer components'));
  const result = await require('postcss')([require('tailwindcss')({ content: [{ raw: '<div></div>' }], corePlugins: { preflight: false } })])
    .process('@tailwind base;\n' + base, { from: undefined });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-document-scroll-'));
  const fixture = path.join(dir, 'fixture.html');
  const css = result.css + '*{box-sizing:border-box}body{margin:0}main{overflow-x:clip;padding:12px}.content{height:1800px;background:white}';
  const html = `<!doctype html><html><body><pre id="result">PENDING</pre><script>
  (async()=>{
    const results=[];
    for(const {width,legacy} of [320,360,375,390,430,768,1280].flatMap(width=>[{width,legacy:true},{width,legacy:false}])){
      const frame=document.createElement('iframe'); frame.style.cssText='width:'+width+'px;height:700px;border:0';
      const loaded=new Promise(resolve=>frame.onload=resolve);
      frame.srcdoc='<!doctype html><html><head><style>'+${JSON.stringify(css)}+(legacy?'html,body{height:100%;overflow-x:hidden;max-width:100vw}':'')+'</style></head><body><main><div class="content">Long remark content</div><details><summary>Step 2: Conversion</summary><div style="height:400px">Conversion form</div></details><div id="end">Last content</div></main></body></html>';
      document.body.append(frame);await loaded;
      const d=frame.contentDocument,w=frame.contentWindow,b=d.body,r=d.documentElement;
      w.scrollTo(0,100000);
      const initial=w.scrollY;
      b.scrollTop=100;
      const disclosure=d.querySelector('details');const before=r.scrollHeight;disclosure.open=true;const expanded=r.scrollHeight;disclosure.open=false;
      const end=d.getElementById('end').getBoundingClientRect().bottom;
      results.push({width,legacy,rootScroll:initial,bodyScroll:b.scrollTop,horizontal:r.scrollWidth>r.clientWidth,bodyOverflow:w.getComputedStyle(b).overflowY,bottomGap:w.innerHeight-end,conversionExpands:expanded>before,conversionClosed:!disclosure.open});
      frame.remove();
    }
    document.getElementById('result').textContent=JSON.stringify(results);
  })();</script></body></html>`;
  fs.writeFileSync(fixture, html);
  const run = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir='+path.join(dir,'profile'), '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(fixture).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 4e6, windowsHide: true });
  if (run.error) throw run.error;
  assert.equal(run.status,0,run.stderr);
  const match=run.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
  assert.ok(match,'Browser did not return fixture results');
  const rows=JSON.parse(match[1]);assert.equal(rows.length,14);
  for(const row of rows){
    if(row.legacy){assert.ok(row.bodyScroll>0,JSON.stringify(row));continue;}
    assert.ok(row.rootScroll>0,JSON.stringify(row));
    assert.equal(row.bodyScroll,0,JSON.stringify(row));
    assert.equal(row.horizontal,false,JSON.stringify(row));
    assert.equal(row.bodyOverflow,'visible',JSON.stringify(row));
    assert.ok(row.bottomGap>=0&&row.bottomGap<=13,JSON.stringify(row));
    assert.ok(row.conversionExpands&&row.conversionClosed,JSON.stringify(row));
  }
  console.log(JSON.stringify(rows,null,2));
  console.log('PASS: document scroll and disclosure geometry at 7 widths');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
