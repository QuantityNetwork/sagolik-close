import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Sagolik Close — From Decision to Ownership";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public/brand/sagolik-close-logo-light.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #021c38 0%, #032a52 55%, #005f6b 100%)", color: "white" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={499} height={96} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 76, lineHeight: 1.05, fontWeight: 700, letterSpacing: -1 }}>From Decision to Ownership.</div>
        <div style={{ marginTop: 20, fontSize: 30, color: "#cfe9ec" }}>One secure workspace for every party in a real-estate closing.</div>
      </div>
      <div style={{ fontSize: 24, letterSpacing: 4, color: "#6fc8cc" }}>CLOSE.SAGOLIK.COM</div>
    </div>,
    size,
  );
}
