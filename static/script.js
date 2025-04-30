// script.js
const video = document.getElementById('video');
const recognizedText = document.getElementById('recognizedText');
let currentStream = null;
let videoDevices = [];
let currentDeviceIndex = 0;

// Initialize webcam feed with selected device
async function initCamera(index = 0) {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: videoDevices.length > 0
            ? { deviceId: { exact: videoDevices[index].deviceId } }
            : { facingMode: "environment" },
        audio: false
    };

    try {
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
    } catch (err) {
        console.error('Error accessing camera: ', err);
    }
}

// Flip between available video devices
async function flipCamera() {
    if (videoDevices.length <= 1) {
        alert("Only one camera found!");
        return;
    }
    currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
    await initCamera(currentDeviceIndex);
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

    const response = await fetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speech, image: imageData })
    });

    const data = await response.json();

    recognizedText.innerText += `\nLocation: ${data.location}`;
    recognizedText.innerText += `\nDetected: ${data.object}`;
    recognizedText.innerText += `\nAssistant: ${data.reply}`;

    speak(`${data.location}. I see ${data.object}. ${data.reply}`);
};

function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.4;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}
