// Imports removed, using globals from script tags
// import { compressImage } from './compressor.js';
// import JSZip from '...';

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const resultsSection = document.getElementById('resultsSection');
const fileList = document.getElementById('fileList');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const startCompressBtn = document.getElementById('startCompressBtn');
const qualityControl = document.getElementById('qualityControl');
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue = document.getElementById('qualityValue');
const modeRadios = document.getElementsByName('mode');

// SVG Modal Elements
const svgModal = document.getElementById('svgModal');
const closeSvgModal = document.getElementById('closeSvgModal');
const processSvgBtn = document.getElementById('processSvgBtn');
const svgActionRadios = document.getElementsByName('svg-action');
const svgGifSettings = document.getElementById('svg-gif-settings');

// State
let processedFiles = [];
let pendingFiles = [];
let currentSvgResolve = null; // Promise resolve for SVG modal

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initDropZone();
    downloadAllBtn.addEventListener('click', handleDownloadAll);
    startCompressBtn.addEventListener('click', startBatchCompression);

    // Quality Slider
    qualitySlider.addEventListener('input', (e) => {
        qualityValue.textContent = `${e.target.value}%`;
    });

    // Mode Switch
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'lossy') {
                qualityControl.style.display = 'block';
            } else {
                qualityControl.style.display = 'none';
            }
        });
    });

    // SVG Modal Events
    closeSvgModal.onclick = () => {
        svgModal.hidden = true;
        if (currentSvgResolve) currentSvgResolve(null); // Cancel
    };

    // Toggle Settings Visibility
    const svgRasterSettings = document.getElementById('svg-raster-settings');
    const rasterQualityGroup = document.getElementById('raster-quality-group');
    const rasterFormatRadios = document.getElementsByName('raster-format');
    const rasterQualitySlider = document.getElementById('raster-quality');
    const rasterQualityVal = document.getElementById('raster-quality-val');
    const gifQualitySlider = document.getElementById('gif-quality');
    const gifQualityVal = document.getElementById('gif-quality-val');

    svgActionRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            svgGifSettings.style.display = e.target.value === 'gif' ? 'block' : 'none';
            svgRasterSettings.style.display = e.target.value === 'raster' ? 'block' : 'none';
        });
    });

    rasterFormatRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            rasterQualityGroup.style.display = e.target.value === 'image/jpeg' ? 'block' : 'none';
        });
    });

    rasterQualitySlider.addEventListener('input', (e) => {
        rasterQualityVal.textContent = `${e.target.value}%`;
    });

    gifQualitySlider.addEventListener('input', (e) => {
        gifQualityVal.textContent = `${e.target.value}%`;
    });

    // Auto-detect Button
    const autoDetectBtn = document.getElementById('autoDetectBtn');
    const gifDurationInput = document.getElementById('gif-duration');

    autoDetectBtn.onclick = async () => {
        if (!currentSvgFile) return;
        autoDetectBtn.textContent = '...';
        const duration = await detectSvgDuration(currentSvgFile);
        gifDurationInput.value = duration;
        autoDetectBtn.textContent = 'Auto';
    };

    processSvgBtn.onclick = () => {
        const action = Array.from(svgActionRadios).find(r => r.checked).value;
        const rasterFormat = Array.from(rasterFormatRadios).find(r => r.checked).value;

        const settings = {
            action,
            // GIF Settings
            duration: parseInt(gifDurationInput.value),
            fps: parseInt(document.getElementById('gif-fps').value),
            maxSizeMB: parseFloat(document.getElementById('gif-max-size').value),
            gifQuality: parseInt(gifQualitySlider.value),
            // Raster Settings
            rasterFormat,
            rasterQuality: parseInt(rasterQualitySlider.value) / 100
        };
        svgModal.hidden = true;
        if (currentSvgResolve) currentSvgResolve(settings);
    };
});

function initDropZone() {
    // Click to browse
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    dropZone.addEventListener('click', (e) => {
        if (e.target === dropZone || e.target.closest('.drop-content')) {
            fileInput.click();
        }
    });

    // File input change
    fileInput.addEventListener('change', handleFiles);

    // Drag & Drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight() {
    dropZone.classList.add('drag-over');
}

function unhighlight() {
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const droppedFiles = dt.files;
    handleFiles({ target: { files: droppedFiles } });
}

function handleFiles(e) {
    const newFiles = [...e.target.files];
    if (newFiles.length > 0) {
        processFiles(newFiles);
    }
}

function processFiles(newFiles) {
    // Show results section if hidden
    if (resultsSection.hidden) {
        resultsSection.hidden = false;
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    // Filter valid images
    const validFiles = newFiles.filter(file => file.type.startsWith('image/'));

    // Check for SVG batch restriction
    const svgFiles = validFiles.filter(file => file.type === 'image/svg+xml');
    if (svgFiles.length > 1) {
        alert('⚠️ Batch Processing Limitation\n\n' +
            'SVG files (especially animated ones) require intensive processing.\n\n' +
            'Please upload SVG files ONE AT A TIME to ensure optimal performance and quality.\n\n' +
            'You can batch process other image formats (PNG, JPG, WebP, etc.) up to 60 images at once.');
        return; // Abort processing
    }

    validFiles.forEach(file => {
        const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        addFileToList(file, fileId);
        pendingFiles.push({ file, fileId });
    });

    // Enable compress button
    if (pendingFiles.length > 0) {
        startCompressBtn.disabled = false;
        startCompressBtn.textContent = `Optimize ${pendingFiles.length} Images`;
    }
}

function addFileToList(file, fileId) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.id = fileId;

    // Create thumbnail placeholder
    const thumbUrl = URL.createObjectURL(file);

    item.innerHTML = `
        <div class="file-thumb-wrapper">
             <img src="${thumbUrl}" class="file-thumb" alt="Preview">
             <span class="thumb-hint">Hold to Compare</span>
        </div>
        <div class="file-info">
            <span class="file-name">${file.name}</span>
            <span class="file-size">${formatBytes(file.size)}</span>
        </div>
        <div class="file-status">
            <span class="status-text">Waiting...</span>
            <div class="progress-bar" hidden><div class="progress-fill"></div></div>
        </div>
        <div class="file-actions" hidden>
            <span class="saved-badge"></span>
            <button class="btn-download" title="Download">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        </div>
    `;
    fileList.appendChild(item);
}

async function startBatchCompression() {
    startCompressBtn.disabled = true;
    startCompressBtn.textContent = 'Processing...';

    const isLossy = document.getElementById('lossy').checked;
    const quality = parseInt(qualitySlider.value) / 100;

    // Process all pending files
    const filesToProcess = [...pendingFiles];
    pendingFiles = []; // Clear pending queue

    for (const { file, fileId } of filesToProcess) {
        await compressSingleFile(file, fileId, isLossy, quality);
    }

    startCompressBtn.textContent = 'Optimize All';
}

// Global variable to hold current file for auto-detect
let currentSvgFile = null;

async function compressSingleFile(file, fileId, isLossy, quality) {
    const item = document.getElementById(fileId);
    const statusText = item.querySelector('.status-text');
    const progressBar = item.querySelector('.progress-bar');
    const fileActions = item.querySelector('.file-actions');
    const savedBadge = item.querySelector('.saved-badge');
    const downloadBtn = item.querySelector('.btn-download');
    const thumbImg = item.querySelector('.file-thumb');
    const thumbWrapper = item.querySelector('.file-thumb-wrapper');

    // Update status
    statusText.textContent = 'Processing...';
    progressBar.hidden = false;

    try {
        let compressedFile;

        // SVG Handling
        if (file.type === 'image/svg+xml') {
            statusText.textContent = 'Waiting for input...';
            currentSvgFile = file; // Store for auto-detect

            // Smart Recommendation Logic
            const duration = await detectSvgDuration(file);

            // UI Elements
            const statusMsg = document.getElementById('svg-status-msg');
            const recMinify = document.getElementById('rec-minify');
            const recRaster = document.getElementById('rec-raster');
            const recGif = document.getElementById('rec-gif');

            // Reset UI
            statusMsg.style.display = 'none';
            recMinify.style.display = 'none';
            recRaster.style.display = 'none';
            recGif.style.display = 'none';

            if (duration > 0) {
                // Animated
                document.getElementById('svg-gif').checked = true;
                // Trigger change to show settings
                document.getElementById('svg-gif').dispatchEvent(new Event('change'));

                statusMsg.innerHTML = `✨ <strong>Animated SVG detected</strong> (~${duration}s). GIF recommended.`;
                statusMsg.style.display = 'block';
                statusMsg.style.borderLeft = '3px solid var(--primary)';

                recGif.style.display = 'inline-block';
                document.getElementById('gif-duration').value = duration;
            } else {
                // Static
                document.getElementById('svg-raster').checked = true;
                document.getElementById('svg-raster').dispatchEvent(new Event('change'));

                statusMsg.innerHTML = `ℹ️ <strong>Static SVG detected</strong>. Convert to Image recommended.`;
                statusMsg.style.display = 'block';
                statusMsg.style.borderLeft = '3px solid #94a3b8';

                recRaster.style.display = 'inline-block';
                recMinify.style.display = 'inline-block';
            }

            // Show Modal and wait for user choice
            svgModal.hidden = false;
            const settings = await new Promise(resolve => {
                currentSvgResolve = resolve;
            });

            if (!settings) {
                statusText.textContent = 'Skipped';
                progressBar.hidden = true;
                return;
            }

            statusText.textContent = 'Processing SVG...';

            if (settings.action === 'minify') {
                compressedFile = await minifySVG(file);
            } else if (settings.action === 'raster') {
                compressedFile = await rasterizeSVG(file, settings.rasterFormat, settings.rasterQuality);
            } else if (settings.action === 'gif') {
                // Use smartCompressGif for GIF
                compressedFile = await smartCompressGif(file, settings, (status) => {
                    statusText.textContent = status;
                    // Optional: Update progress bar if status contains percentage
                    // But for now text is enough
                });
            }

        } else {
            // Standard Image Handling
            const options = {
                maxSizeMB: 1, // Default fallback
                useWebWorker: true,
            };

            if (isLossy) {
                options.initialQuality = quality;
            } else {
                // Lossless attempt (max quality)
                options.initialQuality = 1.0;
                // Note: browser-image-compression is mainly lossy. True lossless is hard in browser JS for all formats.
            }
            compressedFile = await compressImage(file, options);
        }

        // Calculate savings
        const savedBytes = file.size - compressedFile.size;
        const savedPercent = ((savedBytes / file.size) * 100).toFixed(0);

        // Update UI
        statusText.textContent = 'Done';
        statusText.style.color = 'var(--success)';
        progressBar.hidden = true;
        fileActions.hidden = false;

        if (savedBytes > 0) {
            savedBadge.textContent = `-${savedPercent}%`;
            savedBadge.className = 'saved-badge success';
        } else {
            // For conversions (SVG -> GIF/PNG), size might increase.
            // Show new size or just "Converted"
            if (file.type === 'image/svg+xml') {
                savedBadge.textContent = 'Converted';
                savedBadge.className = 'saved-badge neutral';
            } else {
                savedBadge.textContent = `+${Math.abs(savedPercent)}%`;
                savedBadge.className = 'saved-badge neutral';
            }
        }

        // Setup download
        const url = URL.createObjectURL(compressedFile);
        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            // Determine extension
            let ext = file.name.split('.').pop();
            if (compressedFile.type === 'image/png') ext = 'png';
            if (compressedFile.type === 'image/gif') ext = 'gif';
            if (compressedFile.type === 'image/jpeg') ext = 'jpg';

            a.download = file.name.replace(/\.[^/.]+$/, "") + "_optimized." + ext;
            a.click();
        };

        // Update Thumbnail to Optimized Version
        const optimizedUrl = URL.createObjectURL(compressedFile);
        thumbImg.src = optimizedUrl;

        // Setup Hover Compare (Original vs Optimized)
        // Store URLs on element for easy access
        const originalUrl = URL.createObjectURL(file);

        // Hover/Touch events to swap src
        const showOriginal = () => { thumbImg.src = originalUrl; thumbWrapper.classList.add('showing-original'); };
        const showOptimized = () => { thumbImg.src = optimizedUrl; thumbWrapper.classList.remove('showing-original'); };

        thumbWrapper.addEventListener('mouseenter', showOriginal);
        thumbWrapper.addEventListener('mouseleave', showOptimized);
        thumbWrapper.addEventListener('touchstart', (e) => { e.preventDefault(); showOriginal(); });
        thumbWrapper.addEventListener('touchend', (e) => { e.preventDefault(); showOptimized(); });

        // Click to open in new tab
        thumbImg.onclick = () => window.open(optimizedUrl, '_blank');
        thumbImg.style.cursor = 'zoom-in';


        // Store for batch download
        processedFiles.push({ file: compressedFile, originalName: file.name, url });

    } catch (error) {
        console.error(error);
        statusText.textContent = 'Error';
        statusText.style.color = 'var(--error)';
        progressBar.hidden = true;
    }
}

function openComparison(originalFile, compressedFile) {
    const modal = document.getElementById('compareModal');
    const container = document.getElementById('compareContainer');
    const closeModal = document.getElementById('closeModal');

    modal.hidden = false;
    container.innerHTML = ''; // Clear previous

    // Create comparison UI
    const wrapper = document.createElement('div');
    wrapper.className = 'comparison-wrapper';

    const originalUrl = URL.createObjectURL(originalFile);
    const compressedUrl = URL.createObjectURL(compressedFile);

    wrapper.innerHTML = `
        <div class="img-comp-container">
            <div class="img-comp-img img-comp-overlay">
                <img src="${originalUrl}" alt="Original">
                <span class="label">Original</span>
            </div>
            <div class="img-comp-img">
                <img src="${compressedUrl}" alt="Compressed">
                <span class="label">Compressed</span>
            </div>
            <div class="img-comp-slider">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
            </div>
        </div>
    `;
    container.appendChild(wrapper);

    initComparisonSlider(wrapper);

    closeModal.onclick = () => {
        modal.hidden = true;
        URL.revokeObjectURL(originalUrl); // Cleanup temp URL (compressed one is kept for download)
    };
}

function initComparisonSlider(wrapper) {
    const slider = wrapper.querySelector('.img-comp-slider');
    const overlay = wrapper.querySelector('.img-comp-overlay');
    const container = wrapper.querySelector('.img-comp-container');
    let clicked = 0;
    let w, h;

    // Wait for images to load to get dimensions
    const img = overlay.querySelector('img');
    img.onload = () => {
        w = container.offsetWidth;
        h = container.offsetHeight;
        overlay.style.width = (w / 2) + "px";
        slider.style.left = (w / 2) - (slider.offsetWidth / 2) + "px";
    }

    slider.addEventListener('mousedown', slideReady);
    window.addEventListener('mouseup', slideFinish);
    slider.addEventListener('touchstart', slideReady);
    window.addEventListener('touchend', slideFinish);

    function slideReady(e) {
        e.preventDefault();
        clicked = 1;
        window.addEventListener('mousemove', slideMove);
        window.addEventListener('touchmove', slideMove);
    }

    function slideFinish() {
        clicked = 0;
    }

    function slideMove(e) {
        if (clicked == 0) return false;
        let pos = getCursorPos(e);
        if (pos < 0) pos = 0;
        if (pos > w) pos = w;
        slide(pos);
    }

    function getCursorPos(e) {
        let a, x = 0;
        e = (e.changedTouches) ? e.changedTouches[0] : e;
        a = container.getBoundingClientRect();
        x = e.pageX - a.left;
        x = x - window.pageXOffset;
        return x;
    }

    function slide(x) {
        overlay.style.width = x + "px";
        slider.style.left = container.offsetWidth - (container.offsetWidth - x) - (slider.offsetWidth / 2) + "px";
    }
}

async function handleDownloadAll() {
    if (processedFiles.length === 0) return;

    const zip = new JSZip();
    const folder = zip.folder("neon-crush-images");

    // Add files to zip
    processedFiles.forEach(({ file, originalName }) => {
        folder.file(originalName, file);
    });

    try {
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = "neon-crush-optimized.zip";
        a.click();

        // Cleanup
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error("Failed to generate zip:", error);
        alert("Failed to create zip file.");
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
