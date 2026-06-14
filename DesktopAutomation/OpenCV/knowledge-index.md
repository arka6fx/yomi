# OpenCV — Knowledge Index

## Source Metadata
- **Source**: https://github.com/opencv/opencv
- **Type**: Library (not cloned — >500MB, docs suffice)
- **Docs**: https://docs.opencv.org/
- **Language**: C++ with Python bindings
- **Last Updated**: 2026-06-12

## Vision Techniques Relevant to Desktop Automation

### Template Matching (`cv2.matchTemplate`)
- Methods: TM_CCOEFF_NORMED (preferred), TM_SQDIFF_NORMED, TM_CCORR_NORMED
- **Use case**: Find known UI elements (buttons, icons) via screenshot
- **Multi-scale**: Resize template incrementally to handle DPI differences
- **Threshold**: 0.8+ for confident matches, 0.6-0.8 for fuzzy
- **Non-max suppression**: Prevent duplicate detections for repeated UI patterns

### Feature Matching (SIFT, ORB, AKAZE)
- **Use case**: Locate application windows by distinctive visual features
- ORB: Free (BSD), fast, good for real-time
- SIFT: Patent-encumbered, more accurate, robust to scale/rotation
- **Match filtering**: Lowe's ratio test (0.75 threshold), RANSAC homography

### Image Processing Pipeline for UI Screenshots
1. **Grayscale conversion**: `cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)`
2. **Edge detection**: Canny for structural boundaries
3. **Thresholding**: Adaptive threshold for text-heavy regions
4. **Contour detection**: Find rectangular regions (windows, dialogs, buttons)
5. **Morphological ops**: Dilate/erode to merge nearby text into blocks
6. **Connected components**: Label UI regions for OCR batching

### Window/Element Localization
- **Difference detection**: `cv2.absdiff` between before/after screenshots → find changed regions
- **Flash detection**: Briefly highlight target → diff → locate
- **Corner detection**: Harris/Shi-Tomasi for finding UI corners
- **Hough lines**: Find window borders, separator lines

### Performance Optimizations
- **ROI cropping**: Only process regions near last-known position
- **Image pyramid**: Downscale → coarse search → refine at full res
- **Integral images**: O(1) rectangle sums for fast template matching
- **GPU acceleration**: cv2.cuda for batch processing

### Yomi Implementation Opportunities
1. **Visual fallback for UIA-unavailable apps**: Template matching to find buttons/text fields
2. **Element location verification**: Cross-check UIA bounding rects with visual templates
3. **Stale reference recovery**: Use template match to re-find element when UIA ref dies
4. **Offscreen element detection**: Visual scan confirms element is actually visible
5. **Rapid screen diff**: `cv2.absdiff` for "what changed" after an action
6. **Multi-scale icon finding**: Handle DPI-scaled UI with scale pyramid matching
