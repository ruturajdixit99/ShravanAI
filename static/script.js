// script.js
const video = document.getElementById('video');
const recognizedText = document.getElementById('recognizedText');
const detectedText = document.getElementById('detectedText');
const locationText = document.getElementById('locationText');
const assistantReply = document.getElementById('assistantReply');

let currentStream = null;
let videoDevices = [];
let currentDeviceIndex = 0;
let usingFacingMode = 'user';

// Initialize webcam feed (deviceId or facingMode)
async function initCamera(index = 0) {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    let constraints;
    if (videoDevices.length > 1) {
        constraints = { video: { deviceId: { exact: videoDevices[index].deviceId } }, audio: false };
    } else {
        constraints = { video: { facingMode: usingFacingMode }, audio: false };
    }
    try {
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
    } catch (err) {
        console.error('Camera error:', err);
        alert('Camera access error: ' + err.message);
    }
}

// Flip camera: by device list or toggle facingMode
async function flipCamera() {
    if (videoDevices.length > 1) {
        currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
        await initCamera(currentDeviceIndex);
    } else {
        usingFacingMode = usingFacingMode === 'user' ? 'environment' : 'user';
        await initCamera();
    }
}

// Enumerate and start
async function setupDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter(d => d.kind === 'videoinput');
    if (!videoDevices.length) return alert('No camera found.');
    await initCamera(currentDeviceIndex);
}
setupDevices();

// Speech recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = 'en-US';
recognition.interimResults = false;
recognition.maxAlternatives = 1;

function startListening() {
    recognition.start();
    recognizedText.innerText = 'Listening...';
    detectedText.innerText = '';
    locationText.innerText = '';
    assistantReply.innerText = '';
}

recognition.onresult = async (evt) => {
    const speech = evt.results[0][0].transcript;
    recognizedText.innerText = `You said: ${speech}`;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg');

    try {
        const resp = await fetch('/query', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ text: speech, image: imageData })
        });
        const data = await resp.json();
        detectedText.innerText = `Detected: ${data.object}`;
        locationText.innerText = data.location;
        assistantReply.innerText = `Assistant: ${data.reply}`;
        speak(`${data.location}. I see ${data.object}. ${data.reply}`);
    } catch (e) {
        console.error('Fetch error:', e);
        assistantReply.innerText = 'Assistant: Error getting response';
    }
};

function speak(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.3; u.pitch = 1.0; u.volume = 1.0;
    window.speechSynthesis.speak(u);
}
