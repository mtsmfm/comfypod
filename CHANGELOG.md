# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-27

### Added

- `gpu.idleTimeoutMin` config option. When set to a positive number, an in-pod watchdog monitors the ComfyUI `/queue` endpoint every minute and terminates the pod (RunPod REST `DELETE /pods/{id}`) once the queue has been idle for the configured duration. Default `0` disables the watchdog.

## 1.0.5 and earlier

Not tracked in this changelog. See the git history.
