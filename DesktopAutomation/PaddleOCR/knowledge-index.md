# PaddleOCR — Knowledge Index

## Source Metadata
- **Source**: https://github.com/PaddlePaddle/PaddleOCR
- **Type**: Library (not cloned — docs + API suffice)
- **Docs**: https://paddlepaddle.github.io/PaddleOCR/
- **Language**: Python (C++ inference engine)
- **Last Updated**: 2026-06-12

## OCR Pipeline Architecture

### Text Detection
- **DB (Differentiable Binarization)**: Default detector, fast and accurate
- **DB++**: Improved version with better small-text detection
- **EAST**: Alternative for rotated text
- **PSENet**: Progressive scale expansion for dense text
- **Output**: Text bounding boxes + confidence scores

### Text Recognition
- **SVTR**: Latest recognition model, handles irregular text well
- **CRNN**: Classic CTC-based recognition
- **NRTR**: Transformer-based for complex layouts
- **SAR**: 2D attention for irregular/curved text
- **ABINet**: Autonomous bidirectional for context-aware recognition

### Layout Analysis
- **PP-StructureV3**: Document layout analysis (tables, paragraphs, headers)
- **Table recognition**: Extract structured data from tables
- **Key information extraction**: Find specific fields in forms

### Desktop Automation Relevance

#### UI Text Extraction
- **Button labels**: Read text on custom-drawn buttons (games, Electron, Qt custom widgets)
- **Error dialogs**: Extract error message text when UIA only exposes the window title
- **Status bars**: Read status text rendered as pixels
- **Menu items**: Read menu text when UIA tree is flat

#### Element Discovery
- **Text-based element finding**: Find "Submit" / "Cancel" / "OK" buttons by OCR → click coordinates
- **Window title extraction**: When UIA Name property is empty but text is visible
- **Form field labels**: Find labels near input fields for semantic understanding

#### Yomi Integration Points
- **Provider modularity**: Currently `tesseract`, `azure`, `paddleocr`, `easyocr` via env var `YOMI_OCR_PROVIDER`
- **Preprocessing pipeline**: Screenshot → grayscale → contrast enhancement → OCR
- **Post-processing**: Confidence filtering, layout-aware text merging
- **Bounding box → element mapping**: Cross-reference OCR boxes with UIA element rects

### Performance Considerations
- PaddleOCR inference is GPU-accelerated (CUDA/TRT)
- CPU inference is slower but acceptable for single screenshots
- Model warmup: First inference is slow (~2-3s), subsequent calls faster
- **Optimization**: Cache OCR results per window+region hash, only re-OCR changed regions

### Yomi Implementation Opportunities
1. **OCR cache**: Hash-based dedup so repeated screenshots of same window don't re-run OCR
2. **Region-based OCR**: Only OCR the region around the target element, not full screen
3. **Text grounding pipeline**: OCR → text bboxes → semantic grouping (button groups, forms)
4. **Accessibility bridge**: OCR as accessibility data source for apps with broken UIA
5. **Stale ref recovery via OCR**: When UIA ref is stale, OCR to find text → locate element visually
6. **Language-aware OCR**: Configure recognition language per-app
