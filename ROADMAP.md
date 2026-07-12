# CCTV Stream Control - NVR Roadmap

This document outlines the future development roadmap for the project, aiming to elevate it to a fully enterprise-grade Network Video Recorder (NVR) system.

## 🚀 Upcoming Features & Milestones

### 1. 🔍 ONVIF Auto-Discovery
- **Goal:** Automatically scan the local network (LAN) for IP cameras and populate a list.
- **Details:** Eliminate the need for users to manually find and type RTSP URLs. Users can simply select a discovered camera from a list and input their credentials.
- **Protocol:** Implement ONVIF WS-Discovery.

### 2. 🎞️ Smart Timeline Playback
- **Goal:** Replace the standard file-based playback with a continuous, scrollable timeline.
- **Details:** 
  - Build a visual timeline at the bottom of the playback UI.
  - Highlight segments with motion activity in red/orange.
  - **Synchronized Playback:** Allow users to view 4 cameras simultaneously at the exact same past timestamp.

### 3. 🛡️ Role-Based Access Control (RBAC) & Camera Isolation
- **Goal:** Implement Granular Permissions for different users.
- **Roles:**
  - `Admin`: Full access (System settings, disk formatting, all cameras).
  - `Operator`: Can view live feeds and playback, but cannot change system settings.
  - `Viewer`: Can only view live feeds.
- **Camera Isolation:** Ability to assign specific cameras to specific users (e.g., "User A can only view Camera 1 and 2").
- **Audit Logs:** Track and display which user viewed which camera, or who moved the PTZ.

### 4. 🤖 AI & Smart Events (Computer Vision)
- **Goal:** Intelligent filtering of motion detection to reduce false alarms.
- **Features:**
  - **Person/Vehicle Detection:** Only trigger alarms/recording when a human or vehicle is detected (ignoring trees, pets, or shadows).
  - **Line Crossing / Intrusion Zones:** Draw virtual polygons or lines on the camera feed. Send Telegram alerts only if an object crosses the line from the outside in.
- **Implementation Note:** Can be built using lightweight AI models (like YOLOv8 or Frigate's underlying logic) optimized for Mac Mini/Raspberry Pi.

### 5. ✂️ Export & Video Clipping Tool
- **Goal:** Allow users to extract specific incident evidence easily.
- **Details:** 
  - Provide a "Scissors" tool on the timeline.
  - User selects a start time (e.g., 14:00) and an end time (e.g., 14:05).
  - The system processes the chunks and downloads a single, seamless `.mp4` file for the authorities or backup.

---
*This roadmap is a living document and will be updated as the project evolves.*
