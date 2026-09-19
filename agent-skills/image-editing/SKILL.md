---
name: image-editing
description: Provides guidance for analyzing, cropping, and transforming images using coordinates or aspect ratios with Magica Crop Image.
version: 1.0.0
---

# Image Editing Skill

This skill guides the Galaxy Agent when handling user requests to crop, reframe, or adjust visual imagery.

## Available Tools
- `crop_image`: Takes `image_url` and normalized crop coordinates `{ x, y, width, height }` or pixel coordinates.

## Guidance
1. Always confirm the source `image_url` is valid before dispatching the crop tool.
2. For centered framing, calculate bounding coordinates centered around the focal point.
3. Preserve image quality by matching original aspect ratios when not explicitly requested otherwise.
