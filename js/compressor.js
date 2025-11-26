// No import needed, imageCompression is global via script tag
// import imageCompression from '...';

async function compressImage(file, options = {}) {
    const defaultOptions = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        fileType: file.type === 'image/png' ? 'image/png' : 'image/jpeg' // Default target
    };

    // Merge options
    const compressionOptions = { ...defaultOptions, ...options };

    try {
        console.log(`Compressing ${file.name}...`);

        // SVG Handling is now done via specific functions called from app.js
        // This main function is for raster images
        if (file.type === 'image/svg+xml') {
            return file; // Should be handled by specific SVG functions
        }

        // GIF Handling
        if (file.type === 'image/gif') {
            console.log('GIF detected, passing through (optimization TODO)');
            return file;
        }

        const compressedFile = await imageCompression(file, compressionOptions);
        console.log(`Compressed ${file.name}: ${file.size} -> ${compressedFile.size}`);
        return compressedFile;
    } catch (error) {
        console.error('Compression failed:', error);
        throw error;
    }
}

// SVG Minification
async function minifySVG(file) {
    const text = await file.text();
    // Simple regex minification: remove comments, newlines, and extra spaces
    const minified = text
        .replace(/<!--[\s\S]*?-->/g, "") // Remove comments
        .replace(/>\s+</g, "><") // Remove spaces between tags
        .replace(/\s{2,}/g, " ") // Collapse multiple spaces
        .replace(/[\r\n]/g, ""); // Remove newlines

    return new Blob([minified], { type: 'image/svg+xml' });
}

// SVG to Raster (PNG/JPG)
async function rasterizeSVG(file, format = 'image/png', quality = 1.0) {
    return new Promise(async (resolve, reject) => {
        try {
            // Parse SVG to get viewBox dimensions
            const svgText = await file.text();
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
            const svgElement = svgDoc.documentElement;

            let width, height;

            // Try to get dimensions from viewBox first (most reliable for complex SVGs)
            const viewBox = svgElement.getAttribute('viewBox');
            if (viewBox) {
                const parts = viewBox.trim().split(/\s+|,/);
                width = parseFloat(parts[2]);
                height = parseFloat(parts[3]);
            }

            // Fallback to width/height attributes
            if (!width || !height) {
                width = parseFloat(svgElement.getAttribute('width')) || 800;
                height = parseFloat(svgElement.getAttribute('height')) || 600;
            }

            // For high-DPI rendering, use a scale factor
            const scale = 2; // 2x for sharper text/graphics
            const canvasWidth = Math.round(width * scale);
            const canvasHeight = Math.round(height * scale);

            const url = URL.createObjectURL(file);
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                const ctx = canvas.getContext('2d');

                // Fill white background for JPG (otherwise transparent becomes black)
                if (format === 'image/jpeg') {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                }

                // Scale context for high-DPI rendering
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    if (blob) resolve(blob);
                    else reject(new Error("Canvas to Blob failed"));
                }, format, quality);
            };

            img.onerror = reject;
            img.src = url;
        } catch (error) {
            reject(error);
        }
    });
}

// SVG to GIF
async function convertSVGtoGIF(file, duration = 3, fps = 30) {
    // Legacy call support, default quality 10
    return convertSVGtoGIF_Custom(file, duration, fps, null, null, 10);
}

// Auto-detect SVG Duration
async function detectSvgDuration(file) {
    try {
        const text = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "image/svg+xml");

        let maxDuration = 0;

        // Helper to parse time strings like "1.5s", "500ms", "2"
        const parseTime = (val) => {
            if (!val) return 0;
            val = val.trim();
            if (val.endsWith('ms')) {
                return parseFloat(val) / 1000;
            } else if (val.endsWith('s')) {
                return parseFloat(val);
            }
            // Default to seconds if no unit (SMIL standard says default is usually seconds but can be tricky, assuming s)
            return parseFloat(val) || 0;
        };

        // 1. Check SMIL animations (<animate>, <animateTransform>, <set>)
        const animElements = doc.querySelectorAll('animate, animateTransform, set, animateMotion');
        animElements.forEach(el => {
            const dur = parseTime(el.getAttribute('dur'));

            // Handle 'begin' (can be multiple values like "0s; 2s", take the first for simplicity or max?)
            // Usually we care about when the animation *ends*, so begin + dur.
            // If begin is complex (events), we ignore it or assume 0.
            let beginStr = el.getAttribute('begin');
            let begin = 0;
            if (beginStr && /[\d]/.test(beginStr)) {
                // Simple check for numeric begin time
                begin = parseTime(beginStr.split(';')[0]);
            }

            const repeatCount = el.getAttribute('repeatCount');

            if (dur > 0) {
                let total = begin + dur;

                // If repeatCount is a number, multiply
                if (repeatCount && repeatCount !== 'indefinite') {
                    const count = parseFloat(repeatCount);
                    if (!isNaN(count)) {
                        total = begin + (dur * count);
                    }
                }

                maxDuration = Math.max(maxDuration, total);
            }
        });

        // 2. Check CSS Animations (style block AND inline styles)
        const checkCssAnimation = (cssStr) => {
            // Look for 'animation' shorthand or 'animation-duration'/'animation-delay'
            // We focus on the shorthand 'animation: ...' which is common
            // Regex to capture the value after 'animation:' until ';' or end of string
            const animationMatch = cssStr.match(/animation:\s*([^;]+)/i);
            if (animationMatch) {
                const animationValue = animationMatch[1];
                // Split multiple animations by comma
                const animations = animationValue.split(',');

                animations.forEach(anim => {
                    // Extract time values (e.g., 1s, 500ms)
                    // Regex to match time units
                    const times = anim.match(/-?[\d\.]+(?:ms|s)/g);
                    if (times) {
                        const parsedTimes = times.map(t => parseTime(t));
                        let duration = parsedTimes[0] || 0;
                        let delay = parsedTimes[1] || 0; // 2nd time value is delay

                        // If only one time, it's duration, delay is 0
                        // If two, first is duration, second is delay

                        if (duration > 0) {
                            maxDuration = Math.max(maxDuration, duration + delay);
                        }
                    }
                });
            }

            // Also check explicit animation-duration / animation-delay properties
            // (Simple check, assuming they match up if multiple - complex to link them perfectly without full CSS parser)
            const durMatch = cssStr.match(/animation-duration:\s*([^;]+)/i);
            const delMatch = cssStr.match(/animation-delay:\s*([^;]+)/i);

            if (durMatch) {
                const durs = durMatch[1].split(',').map(d => parseTime(d));
                const dels = delMatch ? delMatch[1].split(',').map(d => parseTime(d)) : [];

                durs.forEach((d, i) => {
                    const del = dels[i] || 0;
                    if (d > 0) maxDuration = Math.max(maxDuration, d + del);
                });
            }
        };

        // Scan <style> tags
        const styleElements = doc.querySelectorAll('style');
        styleElements.forEach(style => checkCssAnimation(style.textContent));

        // Scan inline styles on ALL elements
        const allElements = doc.querySelectorAll('*[style]');
        allElements.forEach(el => checkCssAnimation(el.getAttribute('style')));

        // Return 0 if no animation found (static SVG)
        return maxDuration > 0 ? Math.ceil(maxDuration) : 0;
    } catch (e) {
        console.warn("Failed to detect duration", e);
        return 0; // Default to 0 on error too
    }
}

// Smart GIF Compression (Retry Loop)
async function smartCompressGif(file, options, onProgress) {
    let { duration, fps, maxSizeMB, gifQuality = 80 } = options;

    // Smart FPS Reduction for Long Animations
    // If duration > 10s and FPS > 15, reduce to 15 to prevent memory crash/hanging
    if (duration > 10 && fps > 15) {
        console.log(`Smart FPS: Reducing FPS from ${fps} to 15 for long animation (${duration}s)`);
        if (onProgress) onProgress(`Optimizing: Reducing FPS to 15 for stability...`);
        fps = 15;
    }

    // Map 1-100 (User) to 30-1 (GIF Encoder)
    let baseQuality = Math.max(1, Math.min(30, Math.round(1 + (100 - gifQuality) * 0.29)));

    let quality = baseQuality;
    let scale = 1.0;

    // We need to get original dims first
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise(r => { img.onload = r; img.src = url; });
    const originalWidth = img.width || 800;
    const originalHeight = img.height || 600;
    URL.revokeObjectURL(url);

    // Smart Resolution Scaling
    // For long animations (>10s), limit max dimension to 600px
    // For standard animations, limit max dimension to 800px
    // This drastically reduces memory usage and encoding time
    let maxDimension = 800;
    if (duration > 10) maxDimension = 600;
    if (duration > 20) maxDimension = 500; // Very long animations need more aggressive scaling

    const currentMax = Math.max(originalWidth, originalHeight);
    if (currentMax > maxDimension) {
        scale = maxDimension / currentMax;
        console.log(`Smart Scaling: Downscaling from ${currentMax}px to ${maxDimension}px (Scale: ${scale.toFixed(2)})`);
        if (onProgress) onProgress(`Optimizing: Resizing to ${Math.round(originalWidth * scale)}x${Math.round(originalHeight * scale)} for performance...`);
    }

    let attempt = 1;
    const maxAttempts = 3;

    while (attempt <= maxAttempts) {
        const currentWidth = Math.round(originalWidth * scale);
        const currentHeight = Math.round(originalHeight * scale);

        if (onProgress) onProgress(`Generating GIF (Attempt ${attempt}/${maxAttempts})...`);

        const blob = await convertSVGtoGIF_Custom(
            file,
            duration,
            fps,
            currentWidth,
            currentHeight,
            quality,
            (progressMsg) => {
                if (onProgress) onProgress(`Attempt ${attempt}: ${progressMsg}`);
            }
        );

        const sizeMB = blob.size / (1024 * 1024);
        console.log(`Attempt ${attempt}: ${sizeMB.toFixed(2)}MB (Target: ${maxSizeMB}MB)`);

        if (sizeMB <= maxSizeMB || attempt === maxAttempts) {
            return blob;
        }

        // Reduce for next attempt
        scale *= 0.75; // Reduce size
        quality = Math.min(30, quality + 5); // Reduce quality (increase value)
        attempt++;
    }
}

async function convertSVGtoGIF_Custom(file, duration, fps, width, height, quality, onProgress) {
    return new Promise(async (resolve, reject) => {
        try {
            const url = URL.createObjectURL(file);

            // Create a hidden container to embed the SVG
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.top = '-10000px';
            container.style.left = '-10000px';
            container.style.width = `${width}px`;
            container.style.height = `${height}px`;
            document.body.appendChild(container);

            // Embed SVG using object (better for animation access)
            const object = document.createElement('object');
            object.type = 'image/svg+xml';
            object.data = url;
            object.style.width = `${width}px`;
            object.style.height = `${height}px`;
            container.appendChild(object);

            // Wait for SVG to load
            await new Promise((resolveLoad, rejectLoad) => {
                object.onload = resolveLoad;
                object.onerror = rejectLoad;
                setTimeout(rejectLoad, 5000); // 5s timeout
            });

            // Get SVG document and animations
            const svgDoc = object.contentDocument;
            if (!svgDoc) {
                throw new Error('Cannot access SVG document (CORS?)');
            }

            const animations = svgDoc.getAnimations ? svgDoc.getAnimations({ subtree: true }) : [];

            if (onProgress) onProgress(`Found ${animations.length} animations`);

            // Pause all animations and reset to start
            animations.forEach(anim => {
                anim.pause();
                anim.currentTime = 0;
            });

            // Setup GIF encoder
            const gif = new GIF({
                workers: 2,
                quality: quality,
                width: width,
                height: height,
                workerScript: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
            });

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            const totalFrames = duration * fps;
            const frameDuration = 1000 / fps; // ms per frame

            // Capture frames
            for (let i = 0; i < totalFrames; i++) {
                const currentTimeMs = (i / fps) * 1000;

                // Set animation time
                animations.forEach(anim => {
                    anim.currentTime = currentTimeMs;
                });

                // Wait for render (important!)
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => setTimeout(r, 10)); // Extra wait for complex animations

                // Capture frame using SVG serialization
                const svgElement = svgDoc.documentElement;
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svgElement);
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const svgUrl = URL.createObjectURL(svgBlob);

                // Draw to canvas
                const img = new Image();
                await new Promise((resolveImg, rejectImg) => {
                    img.onload = resolveImg;
                    img.onerror = rejectImg;
                    img.src = svgUrl;
                });

                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                URL.revokeObjectURL(svgUrl);

                // Add frame to GIF
                gif.addFrame(ctx, { copy: true, delay: frameDuration });

                // Progress update
                if (i % 5 === 0 || i === totalFrames - 1) {
                    const pct = Math.round((i / totalFrames) * 50);
                    if (onProgress) onProgress(`Capturing ${i + 1}/${totalFrames} (${pct}%)`);
                }
            }

            // Cleanup container
            document.body.removeChild(container);
            URL.revokeObjectURL(url);

            // Render GIF
            if (onProgress) onProgress('Rendering GIF...');

            gif.on('progress', (pct) => {
                const totalPct = 50 + Math.round(pct * 50);
                if (onProgress) onProgress(`Encoding ${Math.round(pct * 100)}% (Total ${totalPct}%)`);
            });

            gif.on('finished', (blob) => {
                resolve(blob);
            });

            gif.render();

        } catch (error) {
            reject(error);
        }
    });
}
