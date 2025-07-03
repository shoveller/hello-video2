import { useRef, useEffect, useState } from 'react';
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';
import { ObjectDetection, load } from '@tensorflow-models/coco-ssd';
// import './Tab1.css';

type Detection = {
    bbox: [number, number, number, number];
    class: string;
    score: number;
};

type FaceRegion = {
    x: number;
    y: number;
    width: number;
    height: number;
};

const applyMosaic = (imageData: ImageData, region: FaceRegion, blockSize: number): ImageData => {
    const { data, width } = imageData;
    const newData = new Uint8ClampedArray(data);

    const { x: regionX, y: regionY, width: regionWidth, height: regionHeight } = region;

    console.log('applyMosaic called with region:', { regionX, regionY, regionWidth, regionHeight });
    console.log('Image dimensions:', width, imageData.height);

    // 경계 검사
    const startX = Math.max(0, Math.floor(regionX));
    const startY = Math.max(0, Math.floor(regionY));
    const endX = Math.min(width, Math.floor(regionX + regionWidth));
    const endY = Math.min(imageData.height, Math.floor(regionY + regionHeight));

    console.log('Processing bounds:', { startX, startY, endX, endY });

    for (let y = startY; y < endY; y += blockSize) {
        for (let x = startX; x < endX; x += blockSize) {
            let r = 0, g = 0, b = 0, count = 0;

            for (let dy = 0; dy < blockSize && y + dy < endY; dy++) {
                for (let dx = 0; dx < blockSize && x + dx < endX; dx++) {
                    const pixelIndex = ((y + dy) * width + (x + dx)) * 4;
                    if (pixelIndex < data.length) {
                        r += data[pixelIndex];
                        g += data[pixelIndex + 1];
                        b += data[pixelIndex + 2];
                        count++;
                    }
                }
            }

            if (count > 0) {
                const avgR = Math.floor(r / count);
                const avgG = Math.floor(g / count);
                const avgB = Math.floor(b / count);

                for (let dy = 0; dy < blockSize && y + dy < endY; dy++) {
                    for (let dx = 0; dx < blockSize && x + dx < endX; dx++) {
                        const pixelIndex = ((y + dy) * width + (x + dx)) * 4;
                        if (pixelIndex < data.length) {
                            newData[pixelIndex] = avgR;
                            newData[pixelIndex + 1] = avgG;
                            newData[pixelIndex + 2] = avgB;
                        }
                    }
                }
            }
        }
    }

    console.log('Mosaic applied, returning new ImageData');
    return new ImageData(newData, width, imageData.height);
};

const detectObjects = async (video: HTMLVideoElement, model: ObjectDetection): Promise<Detection[]> => {
    console.log('Detecting objects...');
    const predictions = await model.detect(video);
    console.log('Predictions:', predictions);

    const detections: Detection[] = [];

    for (const prediction of predictions) {
        console.log('Prediction:', prediction.class, prediction.score);
        if (prediction.score > 0.5 && prediction.class === 'person') {
            const bbox: [number, number, number, number] = [
                prediction.bbox[0],
                prediction.bbox[1],
                prediction.bbox[2],
                prediction.bbox[3]
            ];

            detections.push({
                bbox,
                class: prediction.class,
                score: prediction.score
            });
            console.log('Added person detection:', bbox);
        }
    }

    console.log('Total detections:', detections.length);
    return detections;
};

const drawDetections = (ctx: CanvasRenderingContext2D, detections: Detection[]) => {
    detections.forEach(detection => {
        const [x, y, width, height] = detection.bbox;

        // 녹색 테두리 그리기
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);

        // 배경 박스 그리기
        ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.fillRect(x, y - 25, 120, 25);

        // 텍스트 그리기
        ctx.fillStyle = '#000';
        ctx.font = '14px Arial';
        ctx.fillText(`${detection.class} ${(detection.score * 100).toFixed(1)}%`, x + 5, y - 8);
    });
};

const processFrameWithPipeline = async (
    video: HTMLVideoElement,
    imageData: ImageData,
    model: ObjectDetection,
    mosaicSize: number,
    ctx: CanvasRenderingContext2D
): Promise<void> => {
    const detections = await detectObjects(video, model);

    // 모자이크 처리 - 전체 감지된 영역에 적용
    const personDetections = detections.filter(d => d.class === 'person');
    console.log('Person detections for mosaic:', personDetections.length);

    const regions = personDetections.map(detection => ({
        x: detection.bbox[0],
        y: detection.bbox[1],
        width: detection.bbox[2],
        height: detection.bbox[3]
    }));

    console.log('Regions for mosaic:', regions);

    const processedData = regions.reduce(
        (processedData, region) => {
            console.log('Applying mosaic to region:', region);
            return applyMosaic(processedData, region, mosaicSize);
        },
        imageData
    );

    // 모자이크된 데이터를 캔버스에 적용
    ctx.putImageData(processedData, 0, 0);

    // 감지된 객체 표시 (모자이크 위에 그리기)
    drawDetections(ctx, detections);
};

const Tab1: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [model, setModel] = useState<ObjectDetection | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [mosaicSize, setMosaicSize] = useState(24);
    const animationFrameId = useRef<number | null>(null);

    useEffect(() => {
        console.log('Component mounted');
        const loadModel = async () => {
            try {
                console.log('Loading model...');
                const loadedModel = await load();
                console.log('Model loaded:', loadedModel);
                setModel(loadedModel);
            } catch (error) {
                console.error('Failed to load model:', error);
            }
        };
        loadModel();
    }, []);

    useEffect(() => {
        if (isStreaming) {
            processVideo();
        }
    }, [isStreaming]);

    useEffect(() => {
        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
        };
    }, []);

    const setupCamera = async (): Promise<MediaStream | null> => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 }
            });
            return stream;
        } catch (error) {
            console.error('Camera access denied:', error);
            return null;
        }
    };

    const startCamera = async () => {
        console.log('Starting camera...');
        const stream = await setupCamera();
        console.log('Stream:', stream);
        if (stream && videoRef.current) {
            videoRef.current.srcObject = stream;
            console.log('Video srcObject set');
            await videoRef.current.play();
            console.log('Video playing');
            setIsStreaming(true);
        }
    };

    const stopCamera = () => {
        if (videoRef.current?.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
        }
        setIsStreaming(false);
    };

    const processVideo = () => {
        console.log('processVideo called');
        if (!videoRef.current || !canvasRef.current) {
            console.log('Missing refs:', !videoRef.current, !canvasRef.current);
            return;
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            console.log('No context');
            return;
        }

        const detectFrame = async () => {
            console.log('detectFrame called, isStreaming:', isStreaming);
            if (!isStreaming) return;

            console.log('Video readyState:', video.readyState);
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                console.log('Drawing frame');
                ctx.drawImage(video, 0, 0, 640, 480);

                if (model) {
                    try {
                        const imageData = ctx.getImageData(0, 0, 640, 480);
                        console.log('Processing frame with model');
                        await processFrameWithPipeline(video, imageData, model, mosaicSize, ctx);
                        console.log('Frame processed');
                    } catch (error) {
                        console.error('Error processing frame:', error);
                    }
                }
            }

            animationFrameId.current = requestAnimationFrame(detectFrame);
        };

        detectFrame();
    };

    const handleCameraToggle = () => {
        console.log('handleCameraToggle called, isStreaming:', isStreaming);
        if (isStreaming) {
            stopCamera();
        } else {
            startCamera();
        }
    };

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
            <header style={{ backgroundColor: '#007bff', color: 'white', padding: '1rem 0' }}>
                <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 1rem' }}>
                    <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Face Detection & Mosaic</h1>
                </div>
            </header>
            <main style={{ padding: '20px' }}>
                <canvas
                    ref={canvasRef}
                    width={640}
                    height={480}
                    style={{ width: '100%', maxWidth: '640px', border: '1px solid #ccc' }}
                />
                <video
                    ref={videoRef}
                    width={640}
                    height={480}
                    style={{ display: 'none' }}
                    autoPlay
                    playsInline
                    muted
                />

                <div style={{ marginTop: '20px' }}>
                    <button
                        style={{
                            width: '100%',
                            padding: '12px 24px',
                            backgroundColor: !model ? '#ccc' : '#007bff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '16px',
                            cursor: !model ? 'not-allowed' : 'pointer'
                        }}
                        onClick={handleCameraToggle}
                        disabled={!model}
                    >
                        {isStreaming ? 'Stop Camera' : 'Start Camera'} {model ? '(Model Ready)' : '(Loading...)'}
                    </button>

                    <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#007bff', borderRadius: '4px', border: '1px solid #ddd' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                            Mosaic Size: {mosaicSize}px
                        </label>
                        <input
                            type="range"
                            min={8}
                            max={32}
                            step={4}
                            value={mosaicSize}
                            onChange={(e) => setMosaicSize(parseInt(e.target.value))}
                            style={{ width: '100%' }}
                        />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Tab1;
