import React, { createContext, useContext, useState, useMemo, useEffect, useRef } from "react";
import type { SmartEvent } from "@/types";
import { useLocation } from "react-router-dom";

interface PlaybackState {
  selectedCameraId: string;
  setSelectedCameraId: (id: string) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  playbackInfo: any;
  setPlaybackInfo: (info: any) => void;
  events: SmartEvent[];
  setEvents: React.Dispatch<React.SetStateAction<SmartEvent[]>>;
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
  
  // Custom functions to trigger events in VideoPlayer
  jumpToTimeTrigger: number | null;
  setJumpToTimeTrigger: (ts: number | null) => void;
  loadPlaybackTrigger: number;
  setLoadPlaybackTrigger: React.Dispatch<React.SetStateAction<number>>;

  parsedState: { cameraId?: string; date?: string; eventSeek?: boolean; timestamp?: number } | null;
}

const PlaybackContext = createContext<PlaybackState | undefined>(undefined);

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  
  const parsedState = useMemo(() => {
    const state: { cameraId?: string; date?: string; eventSeek?: boolean; timestamp?: number } = {};
    if (location.state) {
      Object.assign(state, location.state);
    }
    const searchParams = new URLSearchParams(location.search);
    const queryCameraId = searchParams.get("camera") || searchParams.get("cameraId");
    const queryTs = searchParams.get("ts") || searchParams.get("timestamp");
    if (queryCameraId) {
      state.cameraId = queryCameraId;
    }
    if (queryTs) {
      const isUnix = /^\d+$/.test(queryTs);
      const dateObj = isUnix ? new Date(parseInt(queryTs, 10) * 1000) : new Date(queryTs);
      if (!isNaN(dateObj.getTime())) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, "0");
        const day = String(dateObj.getDate()).padStart(2, "0");
        state.date = `${year}-${month}-${day}`;
        state.timestamp = Math.floor(dateObj.getTime() / 1000);
        state.eventSeek = true;
      }
    }
    return Object.keys(state).length > 0 ? state : null;
  }, [location.state, location.search]);

  const [selectedCameraId, setSelectedCameraId] = useState(() => parsedState?.cameraId || "");
  const [cameraSearchQuery, setCameraSearchQuery] = useState("");
  const [isCameraPopoverOpen, setIsCameraPopoverOpen] = useState(false);
  
  const [selectedDate, setSelectedDate] = useState(() => {
    if (parsedState?.date) return parsedState.date;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  const [playbackInfo, setPlaybackInfo] = useState<any>(null);
  const [events, setEvents] = useState<SmartEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [timelineZoom, setTimelineZoom] = useState<"24h" | "6h" | "1h" | "15m" | "5m" | "1m">("24h");
  const [timelineCenterTs, setTimelineCenterTs] = useState<number | null>(null);
  const [currentPlaybackTs, setCurrentPlaybackTs] = useState<number | null>(null);
  const [currentRecordingTime, setCurrentRecordingTime] = useState<string | null>(null);
  const [preciseTimeInput, setPreciseTimeInput] = useState("12:00:00");

  const [downloadStart, setDownloadStart] = useState("12:00");
  const [downloadEnd, setDownloadEnd] = useState("12:05");

  const [activePosterUrl, setActivePosterUrl] = useState<string | null>(null);
  const [activeSnapshot, setActiveSnapshot] = useState<string | null>(null);

  const [playbackWindowMinutes, setPlaybackWindowMinutes] = useState<string>(() => parsedState?.eventSeek ? "15" : "none");
  const [playbackWindowCenterTs, setPlaybackWindowCenterTs] = useState<number | null>(() => parsedState?.eventSeek ? parsedState.timestamp || null : null);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [filterStartTime, setFilterStartTime] = useState("00:00");
  const [filterEndTime, setFilterEndTime] = useState("23:59");

  const [deleteEventTarget, setDeleteEventTarget] = useState<SmartEvent | null>(null);

  const [isPreviewDownloadOpen, setIsPreviewDownloadOpen] = useState(false);
  const [previewStartTs, setPreviewStartTs] = useState<number | null>(null);
  const [previewEndTs, setPreviewEndTs] = useState<number | null>(null);

  const [playerHeight, setPlayerHeight] = useState(0);

  const [jumpToTimeTrigger, setJumpToTimeTrigger] = useState<number | null>(null);
  const [loadPlaybackTrigger, setLoadPlaybackTrigger] = useState(0);

  useEffect(() => {
    if (parsedState) {
      if (parsedState.cameraId && parsedState.cameraId !== selectedCameraId) {
        setSelectedCameraId(parsedState.cameraId);
      }
      if (parsedState.date && parsedState.date !== selectedDate) {
        setSelectedDate(parsedState.date);
      }
      if (parsedState.eventSeek) {
        setPlaybackWindowMinutes("15");
        setPlaybackWindowCenterTs(parsedState.timestamp || null);
      }
    }
  }, [parsedState]);

  const value = {
    selectedCameraId, setSelectedCameraId,
    selectedDate, setSelectedDate,
    playbackInfo, setPlaybackInfo,
    events, setEvents,
    loading, setLoading,
    error, setError,
    isPlaying, setIsPlaying,
    isMuted, setIsMuted,
    volume, setVolume,
    playbackSpeed, setPlaybackSpeed,
    timelineZoom, setTimelineZoom,
    timelineCenterTs, setTimelineCenterTs,
    currentPlaybackTs, setCurrentPlaybackTs,
    currentRecordingTime, setCurrentRecordingTime,
    preciseTimeInput, setPreciseTimeInput,
    downloadStart, setDownloadStart,
    downloadEnd, setDownloadEnd,
    activePosterUrl, setActivePosterUrl,
    activeSnapshot, setActiveSnapshot,
    playbackWindowMinutes, setPlaybackWindowMinutes,
    playbackWindowCenterTs, setPlaybackWindowCenterTs,
    searchKeyword, setSearchKeyword,
    minScore, setMinScore,
    filterStartTime, setFilterStartTime,
    filterEndTime, setFilterEndTime,
    deleteEventTarget, setDeleteEventTarget,
    isPreviewDownloadOpen, setIsPreviewDownloadOpen,
    previewStartTs, setPreviewStartTs,
    previewEndTs, setPreviewEndTs,
    cameraSearchQuery, setCameraSearchQuery,
    isCameraPopoverOpen, setIsCameraPopoverOpen,
    playerHeight, setPlayerHeight,
    jumpToTimeTrigger, setJumpToTimeTrigger,
    loadPlaybackTrigger, setLoadPlaybackTrigger,
    parsedState
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback() {
  const context = useContext(PlaybackContext);
  if (context === undefined) {
    throw new Error("usePlayback must be used within a PlaybackProvider");
  }
  return context;
}
