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

// Initialize camera feed (deviceId or facingMode)
async function initCamera() {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());

    let constraints = {};
    if (videoDevices.length > 1) {
        constraints.video = { deviceId: { exact: videoDevices[currentDeviceIndex].deviceId } };
    } else {
        constraints.video = { facingMode: usingFacingMode };
    }
    constraints.audio = false;

    try {
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
    } catch (err) {
        console.error('Camera init error:', err);
        alert('Camera access error: ' + err.message);
    }
}

// Flip camera: by device list or toggle facingMode
async function flipCamera() {
    if (videoDevices.length > 1) {
        currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
    } else {
        usingFacingMode = usingFacingMode === 'user' ? 'environment' : 'user';
    }
    await initCamera();
}

// Enumerate and start camera
async function setupDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoDevices.length === 0) {
            alert('No camera found.');
            return;
        }
        await initCamera();
    } catch (err) {
        console.error('Device enumeration error:', err);
    }
}
setupDevices();

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = 'en-US';
recognition.interimResults = false;
recognition.maxAlternatives = 1;

// Start listening and reset UI
function startListening() {
    recognizedText.innerText = 'Listening...';
    detectedText.innerText = '';
    locationText.innerText = '';
    assistantReply.innerText = '';
    recognition.start();
}

// Handle recognition result
recognition.onresult = async (event) => {
    const speech = event.results[0][0].transcript;
    recognizedText.innerText = `You said: ${speech}`;

    // Capture current frame
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg');

    // Send to backend
    const backendUrl = window.location.origin;
    console.log('Sending POST to:', backendUrl + '/query');

    try {
        const response = await fetch(backendUrl + '/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: speech, image: imageData })
        });
        console.log('HTTP status:', response.status);
        const raw = await response.text();
        console.log('Raw response:', raw);

        if (!response.ok) {
            assistantReply.innerText = `Error from server (HTTP ${response.status})`;
            return;
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            console.error('JSON parse error:', e);
            assistantReply.innerText = 'Error parsing server response';
            return;
        }

        if (data.error) {
            assistantReply.innerText = `Error: ${data.error}`;
            return;
        }

        // Display results
        detectedText.innerText = `Detected: ${data.object}`;
        locationText.innerText = data.location;
        assistantReply.innerText = `Assistant: ${data.reply}`;
        speak(`${data.location}. I see ${data.object}. ${data.reply}`);
    } catch (err) {
        console.error('Fetch error:', err);
        assistantReply.innerText = `Assistant: Error—${err.message}`;
    }
};

// Speak text using SpeechSynthesis
function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.3;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}
