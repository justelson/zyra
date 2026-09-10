import { resolveAppearance, unavailableAppearance, type ThemePreference, type ZyraAppearance } from '../shared/appearance';
import type { CursorAppearance, CursorFrame, CursorPoint } from './cursor-page';

type PageCall = (id: number, command: string, frame: CursorFrame) => Promise<unknown>;
export class CursorController {
  private points = new Map<number, CursorPoint>();
  private appearance: CursorAppearance = this.resolve('zyra', unavailableAppearance);
  constructor(private page: PageCall) {}
  private resolve(theme: ThemePreference, zyra: ZyraAppearance): CursorAppearance {
    return { light: resolveAppearance(theme,zyra,false).accent, dark: resolveAppearance(theme,zyra,true).accent, reduceMotion: zyra.reduceMotion ?? false };
  }
  setAppearance(theme: ThemePreference, zyra: ZyraAppearance) {
    const appearance = this.resolve(theme,zyra);
    if (JSON.stringify(appearance) === JSON.stringify(this.appearance)) return;
    this.appearance = appearance;
    for (const id of this.points.keys()) void this.page(id,'cursor:appearance',{appearance}).catch(() => {});
  }
  async move(id: number, point: CursorPoint, signal: AbortSignal, durationMs = 180, phase: CursorFrame['phase'] = 'moving') {
    signal.throwIfAborted();
    const from = this.points.get(id);
    this.points.set(id,point);
    const result = await this.page(id,'cursor:update',{...point,from,durationMs:from ? durationMs : 0,phase,appearance:this.appearance}) as {durationMs:number};
    await cursorDelay(result.durationMs,signal);
  }
  async phase(id: number, phase: CursorFrame['phase']) {
    const point = this.points.get(id);
    if (point) await this.page(id,'cursor:update',{...point,phase,appearance:this.appearance});
  }
  forget(id: number) { this.points.delete(id); }
  async destroy(id: number) {
    this.points.delete(id);
    await this.page(id,'cursor:destroy',{}).catch(() => {});
  }
}
export async function cursorDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (ms <= 0) return;
  await new Promise<void>((resolve,reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve(); },ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
