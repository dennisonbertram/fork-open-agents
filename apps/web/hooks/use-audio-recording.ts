"use client";

import { useState, useCallback, useRef } from "react";
import { readApiError } from "@/lib/api/read-api-error";

type RecordingState = "idle" | "recording" | "processing";

interface TranscribeResponse {
  text?: string;
  error?: string;
  details?: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("loadend", () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
      const base64 = result.split(",")[1];
      if (base64) {
        resolve(base64);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function getSupportedMimeType(): string {
  const mimeTypes = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];
  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  // Fallback - let the browser choose
  return "";
}

export function useAudioRecording() {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("");

  const startRecording = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("Permission denied") ||
        message.includes("NotAllowedError")
      ) {
        setError(
          "Microphone access denied. Please allow microphone access to use voice input.",
        );
      } else {
        setError(`Failed to start recording: ${message}`);
      }
      setState("idle");
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder || state !== "recording") {
      return null;
    }

    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release the microphone
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        setState("processing");

        const mimeType = mimeTypeRef.current || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType,
        });

        try {
          const base64Audio = await blobToBase64(audioBlob);

          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio: base64Audio,
              mimeType,
            }),
          });

          if (!response.ok) {
            const errorBody = await response.json().catch(() => null);
            setError(readApiError(errorBody, "Transcription failed").message);
            setState("idle");
            resolve(null);
            return;
          }

          // An unreadable 2xx body is a real failure — let it throw into the
          // catch below so the user sees an error instead of a silent null.
          const data = (await response.json()) as TranscribeResponse;

          setState("idle");
          resolve(data.text ?? null);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Transcription failed: ${message}`);
          setState("idle");
          resolve(null);
        }
      };

      mediaRecorder.stop();
    });
  }, [state]);

  const toggleRecording = useCallback(async (): Promise<string | null> => {
    if (state === "recording") {
      return stopRecording();
    } else if (state === "idle") {
      await startRecording();
      return null;
    }
    return null;
  }, [state, startRecording, stopRecording]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    state,
    error,
    clearError,
    startRecording,
    stopRecording,
    toggleRecording,
    isRecording: state === "recording",
    isProcessing: state === "processing",
  };
}
