import { Capacitor, registerPlugin } from "@capacitor/core";
interface NativeStore {
  read(): Promise<{ state?: string }>;
  write(input: { state: string }): Promise<void>;
  getLaunch(): Promise<{ text?: string; route?: string; item?: string }>;
  remind(input: {
    id: string;
    title: string;
    at: number;
  }): Promise<{ scheduled: boolean }>;
  dictate(): Promise<{ text: string }>;
}
export const native = Capacitor.isNativePlatform()
  ? registerPlugin<NativeStore>("ListFlowStorage")
  : null;
