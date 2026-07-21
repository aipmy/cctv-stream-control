import { create } from "zustand";
import type { SmartEvent } from "@/types";

interface PlaybackState {
  selectedCameraId: string;
  setSelectedCameraId: (id: string) => void;
  
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  
  playbackInfo: any;
  setPlaybackInfo: (info: any) => void;
  
  events: SmartEvent[];
  setEvents: (events: SmartEvent[] | ((prev: SmartEvent[]) => SmartEvent[])) => void;
  
  loading: boolean;
  setLoading: (loading: boolean) => void;
  
  error: string | null;
  setError: (error: string | null) => void;
  
  isPlaying: boolean;
  setIsPlaying: (playing: boolean | ((prev: boolean) => boolean)) => void;
  
  isMuted: boolean;
  setIsMuted: (muted: boolean | ((prev: boolean) => boolean)) => void;
  
  volume: number;
  setVolume: (volume: number) => void;
  
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  
  timelineZoom: "24h" | "6h" | "1h" | "15m" | "5m" | "1m";
  setTimelineZoom: (zoom: "24h" | "6h" | "1h" | "15m" | "5m" | "1m") => void;
  
  timelineCenterTs: number | null;
  setTimelineCenterTs: (ts: number | null) => void;
  
  currentPlaybackTs: number | null;
  setCurrentPlaybackTs: (ts: number | null) => void;
  
  currentRecordingTime: string | null;
  setCurrentRecordingTime: (time: string | null) => void;
  
  preciseTimeInput: string;
  setPreciseTimeInput: (input: string) => void;
  
  downloadStart: string;
  setDownloadStart: (start: string) => void;
  
  downloadEnd: string;
  setDownloadEnd: (end: string) => void;
  
  activePosterUrl: string | null;
  setActivePosterUrl: (url: string | null) => void;
  
  activeSnapshot: string | null;
  setActiveSnapshot: (snapshot: string | null) => void;
  
  playbackWindowMinutes: string;
  setPlaybackWindowMinutes: (minutes: string) => void;
  
  playbackWindowCenterTs: number | null;
  setPlaybackWindowCenterTs: (ts: number | null) => void;
  
  searchKeyword: string;
  setSearchKeyword: (keyword: string) => void;
  
  minScore: number;
  setMinScore: (score: number) => void;
  
  filterStartTime: string;
  setFilterStartTime: (time: string) => void;
  
  filterEndTime: string;
  setFilterEndTime: (time: string) => void;
  
  deleteEventTarget: SmartEvent | null;
  setDeleteEventTarget: (target: SmartEvent | null) => void;
  
  isDownloadFormOpen: boolean;
  setIsDownloadFormOpen: (open: boolean) => void;
  
  isPreviewDownloadOpen: boolean;
  setIsPreviewDownloadOpen: (open: boolean) => void;
  
  previewStartTs: number | null;
  setPreviewStartTs: (ts: number | null) => void;
  
  previewEndTs: number | null;
  setPreviewEndTs: (ts: number | null) => void;

  cameraSearchQuery: string;
  setCameraSearchQuery: (q: string) => void;
  
  isCameraPopoverOpen: boolean;
  setIsCameraPopoverOpen: (open: boolean) => void;
  
  playerHeight: number;
  setPlayerHeight: (h: number) => void;
  
  jumpToTimeTrigger: number | null;
  setJumpToTimeTrigger: (ts: number | null) => void;
  
  pendingSeekTs: number | null;
  setPendingSeekTs: (ts: number | null) => void;
  
  loadPlaybackTrigger: number;
  setLoadPlaybackTrigger: (val: number | ((prev: number) => number)) => void;
}

const getTodayDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  selectedCameraId: "",
  setSelectedCameraId: (id) => set({ selectedCameraId: id }),
  
  selectedDate: getTodayDateString(),
  setSelectedDate: (date) => set({ selectedDate: date }),
  
  playbackInfo: null,
  setPlaybackInfo: (info) => set({ playbackInfo: info }),
  
  events: [],
  setEvents: (events) => set((state) => ({ 
    events: typeof events === "function" ? events(state.events) : events 
  })),
  
  loading: false,
  setLoading: (loading) => set({ loading }),
  
  error: null,
  setError: (error) => set({ error }),
  
  isPlaying: false,
  setIsPlaying: (playing) => set((state) => ({
    isPlaying: typeof playing === "function" ? playing(state.isPlaying) : playing
  })),
  
  isMuted: true,
  setIsMuted: (muted) => set((state) => ({
    isMuted: typeof muted === "function" ? muted(state.isMuted) : muted
  })),
  
  volume: 1,
  setVolume: (volume) => set({ volume }),
  
  playbackSpeed: 1,
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  
  timelineZoom: "15m",
  setTimelineZoom: (zoom) => set({ timelineZoom: zoom }),
  
  timelineCenterTs: null,
  setTimelineCenterTs: (ts) => set({ timelineCenterTs: ts }),
  
  currentPlaybackTs: null,
  setCurrentPlaybackTs: (ts) => set({ currentPlaybackTs: ts }),
  
  currentRecordingTime: null,
  setCurrentRecordingTime: (time) => set({ currentRecordingTime: time }),
  
  preciseTimeInput: "12:00:00",
  setPreciseTimeInput: (input) => set({ preciseTimeInput: input }),
  
  downloadStart: "12:00",
  setDownloadStart: (start) => set({ downloadStart: start }),
  
  downloadEnd: "12:05",
  setDownloadEnd: (end) => set({ downloadEnd: end }),
  
  activePosterUrl: null,
  setActivePosterUrl: (url) => set({ activePosterUrl: url }),
  
  activeSnapshot: null,
  setActiveSnapshot: (snapshot) => set({ activeSnapshot: snapshot }),
  
  playbackWindowMinutes: "none",
  setPlaybackWindowMinutes: (minutes) => set({ playbackWindowMinutes: minutes }),
  
  playbackWindowCenterTs: null,
  setPlaybackWindowCenterTs: (ts) => set({ playbackWindowCenterTs: ts }),
  
  searchKeyword: "",
  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),
  
  minScore: 0,
  setMinScore: (score) => set({ minScore: score }),
  
  filterStartTime: "00:00",
  setFilterStartTime: (time) => set({ filterStartTime: time }),
  
  filterEndTime: "23:59",
  setFilterEndTime: (time) => set({ filterEndTime: time }),
  
  deleteEventTarget: null,
  setDeleteEventTarget: (target) => set({ deleteEventTarget: target }),
  
  isDownloadFormOpen: false,
  setIsDownloadFormOpen: (open) => set({ isDownloadFormOpen: open }),
  
  isPreviewDownloadOpen: false,
  setIsPreviewDownloadOpen: (open) => set({ isPreviewDownloadOpen: open }),
  
  previewStartTs: null,
  setPreviewStartTs: (ts) => set({ previewStartTs: ts }),
  
  previewEndTs: null,
  setPreviewEndTs: (ts) => set({ previewEndTs: ts }),
  
  cameraSearchQuery: "",
  setCameraSearchQuery: (q) => set({ cameraSearchQuery: q }),
  
  isCameraPopoverOpen: false,
  setIsCameraPopoverOpen: (open) => set({ isCameraPopoverOpen: open }),
  
  playerHeight: 0,
  setPlayerHeight: (h) => set({ playerHeight: h }),
  
  jumpToTimeTrigger: null,
  setJumpToTimeTrigger: (ts) => set({ jumpToTimeTrigger: ts }),
  
  pendingSeekTs: null,
  setPendingSeekTs: (ts) => set({ pendingSeekTs: ts }),
  
  loadPlaybackTrigger: 0,
  setLoadPlaybackTrigger: (val) => set((state) => ({
    loadPlaybackTrigger: typeof val === "function" ? val(state.loadPlaybackTrigger) : val
  }))
}));
