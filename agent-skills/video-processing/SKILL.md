---
name: video-processing
description: Provides guidance for stitching, dissolving, and fading multiple video clips using Magica Merge Videos.
version: 1.0.0
---

# Video Processing Skill

This skill guides the Galaxy Agent when concatenating multiple video tracks with smooth cinematic transitions.

## Available Tools
- `merge_videos`: Accepts 2 to 100 ordered `video_urls` and transition types (`none`, `fade`, `dissolve`).

## Guidance
1. Ensure at least two video URLs are provided.
2. Verify input ordering: chronological or narrative sequence matters.
3. Choose `dissolve` for seamless blending or `fade` for scene transitions.
