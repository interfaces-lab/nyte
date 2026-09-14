import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";

const WAVEFORM_LEVELS = 8;

/** Speech recognition state shared by the composer and the compose sheet. */
export function useDictation(onTranscript: (transcript: string) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string>();
  const recordingRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useSpeechRecognitionEvent("result", (event) => {
    onTranscriptRef.current(event.results[0]?.transcript ?? "");
  });
  useSpeechRecognitionEvent("volumechange", (event) => {
    setLevels((current) => [...current.slice(-(WAVEFORM_LEVELS - 1)), event.value]);
  });
  useSpeechRecognitionEvent("end", () => {
    recordingRef.current = false;
    setRecording(false);
  });
  useSpeechRecognitionEvent("error", (event) => {
    recordingRef.current = false;
    setRecording(false);
    setError(event.message);
  });
  useEffect(
    () => () => {
      if (recordingRef.current) ExpoSpeechRecognitionModule.abort();
    },
    [],
  );
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const stop = () => {
    setError(undefined);
    if (recordingRef.current) ExpoSpeechRecognitionModule.stop();
  };

  const start = async () => {
    setError(undefined);
    if (recordingRef.current) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("Speech recognition isn't available on this device.");
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError("Microphone or speech recognition permission is off. Enable it in Settings.");
      return;
    }
    setLevels([]);
    setElapsed(0);
    try {
      ExpoSpeechRecognitionModule.start({
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      });
      recordingRef.current = true;
      setRecording(true);
    } catch {
      setError("Couldn't start dictation. Try again.");
    }
  };

  return { recording, elapsed, levels, error, start, stop };
}

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Normalized microphone level to a bar height. */
export function waveHeight(level: number): number {
  return 4 + Math.min(1, Math.max(0, (level + 2) / 12)) * 24;
}
