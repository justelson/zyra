import type { AssistantActivity } from '@shared/assistant/contracts'
export const chart = `<visualization title="Fictional packet arrivals" summary="Six fictional sample windows, 12 to 64 packets." height="360">
<p class="caption">Invented packet counts · six sampling windows</p>
<style>.caption{font-size:12px;color:var(--viz-muted);margin:0 0 12px}.axis{fill:var(--viz-muted);font-size:12px}svg circle{cursor:crosshair}svg{display:block}td,th{font-variant-numeric:tabular-nums}</style>
<svg viewBox="0 0 720 210" role="img" aria-label="Packet arrivals">
<path d="M42 30H692 M42 80H692 M42 130H692 M42 180H692" stroke="var(--viz-border)" fill="none"/>
<path d="M42 164L172 136L302 150L432 98L562 118L692 58V180H42Z" fill="var(--viz-accent)" opacity=".12"/>
<path d="M42 164L172 136L302 150L432 98L562 118L692 58" stroke="var(--viz-accent)" stroke-width="3" fill="none"/>
${[12,32,22,48,39,64].map((value,i)=>`<circle cx="${42+i*130}" cy="${[164,136,150,98,118,58][i]}" r="4" fill="var(--viz-accent)" data-viz-tooltip="Window ${i+1} · ${value} packets"><title>Window ${i+1}: ${value} packets</title></circle><text x="${42+i*130}" y="203" text-anchor="middle" class="axis">${i+1}</text>`).join('')}
<text x="10" y="34" class="axis">60</text><text x="10" y="84" class="axis">40</text><text x="10" y="134" class="axis">20</text><text x="18" y="184" class="axis">0</text>
</svg><details><summary>Show data table</summary><table style="width:100%"><thead><tr><th>Window</th><th>Packets</th></tr></thead><tbody>${[12,32,22,48,39,64].map((value,i)=>`<tr><td>${i+1}</td><td>${value}</td></tr>`).join('')}</tbody></table></details>
</visualization>`
export const compact = `<visualization title="Imaginary moon-base battery" summary="68 percent remaining, fictional." height="320">
<p style="font-size:28px;margin-bottom:12px">68% remaining</p><div style="height:28px;background:var(--viz-track)"><div style="height:100%;width:68%;background:var(--viz-series-2)" data-viz-tooltip="68% remaining · 32% used"></div></div><figcaption>Fictional battery · full capacity = 100%</figcaption>
</visualization>`
export const diagram = `flowchart TD
 A[Raw Markdown] --> B{Parse block}
 B -->|Table| C[Align cells]
 B -->|Code| D[Highlight source]
 B -->|Visualization| E[Sandbox HTML / SVG]
 B -->|Paragraph| F[Render inline tokens]
 C --> G[Chat timeline]
 D --> G
 E --> G
 F --> G
 G --> H{Overflow?}
 H -->|Yes| I[Scroll or wrap]
 H -->|No| J[Continue reading]`
const payload = (tool:string,args:object,result:unknown,status='completed') => ({toolName:'plugin_mcp',pluginId:'sample-notion',pluginSlug:'notion',pluginName:'Notion',server:'notion',action:'call',target:tool,args:{action:'call',pluginId:'sample-notion',server:'notion',tool,arguments:args},result:{details:{result:{content:[{type:'text',text:JSON.stringify(result)}]}}},output:JSON.stringify(result),status})
export const pluginActivities:AssistantActivity[] = [
    {id:'review-plugin-search',kind:'plugin-mcp',tone:'tool',summary:'Using Plugin',turnId:'review-turn',createdAt:new Date().toISOString(),payload:payload('search_pages',{query:'Weekly progress'},{results:[{title:'Weekly progress check-in',type:'page',url:'https://example.test/weekly'},{title:'Shipping checklist',type:'page',url:'https://example.test/shipping'}]})},
    {id:'review-plugin-read',kind:'tool',tone:'tool',summary:'Using Plugin',turnId:'review-turn',createdAt:new Date().toISOString(),payload:payload('retrieve_page',{page_id:'sample-weekly-page'},{metadata:{title:'Weekly progress check-in',type:'page',url:'https://example.test/weekly'},content:'Summary of the fictional weekly plan.'})},
    {id:'review-plugin-active',kind:'plugin-mcp',tone:'tool',summary:'Using Plugin',turnId:'review-turn',createdAt:new Date().toISOString(),payload:payload('update_page',{title:'Release notes'},{},'running')},
    {id:'review-plugin-failed',kind:'plugin-mcp',tone:'error',summary:'Plugin action failed',turnId:'review-turn',createdAt:new Date().toISOString(),payload:payload('retrieve_page',{page_id:'sample-unavailable'},{error:'This sample page is unavailable.'},'failed')}
]
