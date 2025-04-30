// script.js
const video = document.getElementById('video');
const recognizedText = document.getElementById('recognizedText');
const assistantReply = document.getElementById('assistantReply');

let currentStream = null;
let videoDevices = [];
let currentDeviceIndex = 0;
let usingFacingMode = 'user';

// Initialize webcam feed with selected device or facing mode
async function initCamera(index = 0, facing = 'user') {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: videoDevices.length > 1
            ? { deviceId: { exact: videoDevices[index].deviceId } }
            : { facingMode: { exact: facing } },
        audio: false
    };

    try {
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
    } catch (err) {
        console.error('Error accessing camera: ', err);
    }
}

// Flip between available video devices or toggle facingMode
async function flipCamera() {
    if (videoDevices.length > 1) {
        currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
        await initCamera(currentDeviceIndex);
    } else {
        usingFacingMode = usingFacingMode === 'user' ? 'environment' : 'user';
        await initCamera(0, usingFacingMode);
    }
}

// Setup available devices on page load
async function setupDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === "videoinput");
        if (videoDevices.length === 0) {
            alert("No camera found.");
            return;
        }
        await initCamera(currentDeviceIndex);
    } catch (err) {
        console.error("Error initializing devices: ", err);
    }
}
setupDevices();

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = false;
recognition.lang = 'en-US';
recognition.interimResults = false;
recognition.maxAlternatives = 1;

function startListening() {
    recognition.start();
}

// Handle recognition result
recognition.onresult = async (event) => {
    const speech = event.results[0][0].transcript;
    recognizedText.innerText = `You said: ${speech}`;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg');

    try {
        const response = await fetch('/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: speech, image: imageData })
        });

        const data = await response.json();
        assistantReply.innerText = `Assistant: ${data.reply}`;
        speak(data.reply);
    } catch (err) {
        console.error('Error fetching assistant reply:', err);
    }
};

// Speech synthesis
function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.4;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}
