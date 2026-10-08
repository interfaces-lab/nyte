import { useFocusEffect } from "expo-router";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import type { ExpoSpeechRecognitionErrorCode } from "expo-speech-recognition";
// oxlint-disable-next-line no-restricted-imports -- the elapsed clock runs only while recording
import { useCallback, useEffect, useRef, useState } from "react";

const WAVEFORM_LEVELS = 8;

let recognizerOwner: symbol | undefined;

/**
 * What a recognizer failure reads as. The platform's own message names its
 * internals ("Failed to initialize recognizer"), so the code chooses the
 * sentence and the message stays out of the composer.
 */
function dictationFailure(code: ExpoSpeechRecognitionErrorCode): string | undefined {
  switch (code) {
    case "aborted":
      return undefined;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech recognition permission is off. Enable it in Settings.";
    case "no-speech":
    case "speech-timeout":
      return "Didn't catch that. Try again.";
    case "network":
      return "Dictation needs a connection right now.";
    case "audio-capture":
    case "interrupted":
      return "The microphone wasn't available. Try again.";
    case "busy":
      return "Dictation is already running.";
    case "language-not-supported":
      return "Dictation doesn't support this language.";
    case "bad-grammar":
    case "client":
    case "unknown":
      return "Dictation isn't available here.";
    default: {
      const exhaustive: never = code;

      return exhaustive;
    }
  }
}

/** Speech recognition state shared by the composer and the compose sheet. */
export function useDictation(onTranscript: (transcript: string) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string>();
  const focused = useRef(false);
  const session = useRef<symbol | undefined>(undefined);
  const recognitionStarted = useRef(false);

  useSpeechRecognitionEvent("result", (event) => {
    if (session.current === undefined || recognizerOwner !== session.current) return;
    onTranscript(event.results[0]?.transcript ?? "");
  });
  useSpeechRecognitionEvent("volumechange", (event) => {
    if (session.current === undefined || recognizerOwner !== session.current) return;
    setLevels((current) => [...current.slice(-(WAVEFORM_LEVELS - 1)), event.value]);
  });
  useSpeechRecognitionEvent("end", () => {
    if (session.current === undefined || recognizerOwner !== session.current) return;
    recognizerOwner = undefined;
    session.current = undefined;
    recognitionStarted.current = false;
    setRecording(false);
  });
  useSpeechRecognitionEvent("error", (event) => {
    if (session.current === undefined || recognizerOwner !== session.current) return;
    setRecording(false);
    setError(dictationFailure(event.error));
  });
  useFocusEffect(
    useCallback(() => {
      focused.current = true;

      return () => {
        focused.current = false;
        const owner = session.current;
        session.current = undefined;
        setRecording(false);

        if (owner === undefined || recognizerOwner !== owner) return;

        if (!recognitionStarted.current) {
          recognizerOwner = undefined;

          return;
        }

        recognitionStarted.current = false;

        const ended = ExpoSpeechRecognitionModule.addListener("end", () => {
          ended.remove();

          if (recognizerOwner === owner) recognizerOwner = undefined;
        });

        ExpoSpeechRecognitionModule.abort();
      };
    }, []),
  );
  // The clock runs only while the speech session does.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);

    return () => clearInterval(timer);
  }, [recording]);

  const stop = () => {
    setError(undefined);

    if (recognitionStarted.current) ExpoSpeechRecognitionModule.stop();
  };

  const start = async () => {
    if (!focused.current) return;
    setError(undefined);

    if (recognitionStarted.current) {
      ExpoSpeechRecognitionModule.stop();

      return;
    }

    if (recognizerOwner !== undefined) {
      setError("Dictation is already running.");

      return;
    }

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("Speech recognition isn't available on this device.");

      return;
    }

    const owner = Symbol();
    recognizerOwner = owner;
    session.current = owner;

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (session.current !== owner || recognizerOwner !== owner) return;

      if (!permission.granted) {
        session.current = undefined;
        recognizerOwner = undefined;
        setError("Microphone or speech recognition permission is off. Enable it in Settings.");

        return;
      }

      setLevels([]);
      setElapsed(0);
      recognitionStarted.current = true;
      setRecording(true);
      ExpoSpeechRecognitionModule.start({
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      });
    } catch {
      if (session.current !== owner || recognizerOwner !== owner) return;
      session.current = undefined;
      recognizerOwner = undefined;
      recognitionStarted.current = false;
      setRecording(false);
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
