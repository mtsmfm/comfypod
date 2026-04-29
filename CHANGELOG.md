# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-04-29

### Added

- Desktop notification (via `node-notifier`) when the GPU pod is ready and the ComfyUI URL is printed.

### Changed

- Pod self-termination on idle timeout now uses the pre-installed `runpodctl remove pod` instead of the REST `DELETE /pods/{id}` endpoint. The user-supplied API key passed via env was being overridden by RunPod's pod-scoped key inside the pod, which returns 403 on DELETE; `runpodctl` ships with credentials authorized for self-termination.
- Watchdog activity detection now also tracks `/history` size changes in addition to the `/queue` busy signal, catching short ComfyUI jobs (e.g. API calls under 60s) that would otherwise complete between watchdog polls and falsely register as idle.
- Watchdog resets the idle timer on the first `unhealthy → healthy` transition, so the configured `idleTimeoutMin` window starts when ComfyUI is actually accepting requests rather than when the watchdog itself starts.
- Watchdog logs the pod ID at startup and the `runpodctl` exit code / output for each termination attempt, making failures debuggable from the RunPod console logs.

### Removed

- `RUNPOD_API_KEY` environment variable previously injected into the pod when `idleTimeoutMin > 0`. The watchdog no longer needs the user's API key since termination goes through `runpodctl`.

### Fixed

- A failed termination attempt no longer waits an hour before retrying. The watchdog now returns to its normal 60-second cycle until termination succeeds.

## [1.1.0] - 2026-04-27

### Added

- `gpu.idleTimeoutMin` config option. When set to a positive number, an in-pod watchdog monitors the ComfyUI `/queue` endpoint every minute and terminates the pod (RunPod REST `DELETE /pods/{id}`) once the queue has been idle for the configured duration. Default `0` disables the watchdog.

## 1.0.5 and earlier

Not tracked in this changelog. See the git history.
