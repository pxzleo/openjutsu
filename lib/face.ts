// Face post-processing regenerates overlapping crops and pastes the face back.
// The repair styles skip large faces. Replace face tracks the subject in the video and uses the photo for generation.
// workflows/face.api.json is written by workflows/build/openjutsu_face_build.py with Follow the mouth on;
// each request prunes it. Nodes are found by title.
import { nodeByTitle } from "./advanced.ts";
import type { ApiGraph } from "./simple.ts";

export const FACE_STYLES = ["photo", "mouth", "swap"] as const;
export type FaceStyle = (typeof FACE_STYLES)[number];

export type FaceSettings = { style: FaceStyle; seed: number; chunkSeconds: number };

export const FACE_VIDEO = "Video to fix";
export const FACE_PICTURE = "Picture 1";
export const CHUNK_SECONDS = { min: 2.5, max: 15, default: 6.5 };

// Mirrors H3FaceChunks in the swap pack, before chunks with only close-ups are dropped.
const FPS = 24;
const OVERLAP = 24;
export function faceChunkCount(durationSeconds: number, chunkSeconds: number) {
  const total = Math.floor(durationSeconds * FPS);
  const length = Math.floor((Math.floor(chunkSeconds * FPS) - 5) / 17) * 17 + 5;
  return total <= length ? 1 : Math.ceil((total - OVERLAP) / (length - OVERLAP));
}

export function pruneFace(source: ApiGraph, settings: FaceSettings): ApiGraph {
  const graph: ApiGraph = structuredClone(source);
  const id = (title: string) => nodeByTitle(graph, title);
  const chunks = graph[id("Face Fix Chunks")].inputs;
  if (settings.style === "photo" || settings.style === "swap") {
    delete graph[id("Blurred face (follow the mouth)")];
    delete chunks.follow_mouth;
    delete graph[id("Reference Conditioning")].inputs["ref_videos.ref_video_0"];
  }
  if (settings.style === "swap") {
    delete graph[id("Track + crop the face")].inputs.identity_reference;
    chunks.skip_faces_above = 1;
  }
  chunks.chunk_seconds = settings.chunkSeconds;
  graph[id("Seed")].inputs.noise_seed = settings.seed;
  return graph;
}
