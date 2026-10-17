import { use } from "react";
import { ports } from "./ports.ts";

/** Runs one probe step, answering what it did or the name of the error it threw. */
async function attempt(step: () => Promise<string>): Promise<string> {
  try {
    return await step();
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
}

/** Gathers ICE candidates against the test's STUN (UDP) and TURN (TCP) listeners, for up to 2.5 s. */
async function gather(): Promise<string> {
  const connection = new RTCPeerConnection({
    iceServers: [
      { urls: `stun:127.0.0.1:${ports.stun}` },
      {
        urls: `turn:127.0.0.1:${ports.turn}?transport=tcp`,
        username: "probe",
        credential: "probe",
      },
    ],
  });
  connection.createDataChannel("probe");
  await connection.setLocalDescription(await connection.createOffer());
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 2500);
    connection.addEventListener("icegatheringstatechange", () => {
      if (connection.iceGatheringState === "complete") resolve();
    });
  });
  connection.close();

  return "gathered";
}

/** What a canvas can reach from the page it runs in. */
const probe = (async () => ({
  secure: isSecureContext,
  stored: await attempt(async () => {
    const before = localStorage.getItem("nyte-probe") ?? "empty";
    localStorage.setItem("nyte-probe", "set");

    return before;
  }),
  geolocation: await new Promise<string>((resolve) =>
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : `error ${error.code}`),
      { timeout: 2000 },
    ),
  ),
  notifications: await attempt(async () =>
    (await Notification.requestPermission()) === "granted" ? "granted" : "refused",
  ),
  media: await attempt(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    stream.getTracks().forEach((track) => track.stop());

    return "granted";
  }),
  activated: navigator.userActivation.isActive,
  ice: await attempt(gather),
}))();

export default function Probe() {
  const report = use(probe);
  console.log(`probe ${JSON.stringify(report)}`);

  return <pre>{JSON.stringify(report, null, 2)}</pre>;
}
