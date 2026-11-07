export interface Screenshot {
  id: string;
  profileId: string;
  profileName: string;
  name: string;
  createdAt: number;
  bytes: number;
  width: number;
  height: number;
  source: "local" | "received";
  from: string | null;
}
export interface ScreenshotLibrary {
  items: Screenshot[];
  warnings: string[];
}
export interface ScreenshotTransfer {
  id: string;
  batch: string;
  peer: string;
  direction: "incoming" | "outgoing";
  status:
    | "queued"
    | "connecting"
    | "sending"
    | "delivered"
    | "receiving"
    | "received"
    | "failed"
    | "cancelled";
  name: string;
  profileName: string;
  width: number;
  height: number;
  bytes: number;
  transferred: number;
  createdAt: number;
  error: string | null;
}
