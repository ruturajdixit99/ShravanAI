// script.js
const video = document.getElementById('video');
const recognizedText = document.getElementById('recognizedText');

// Start webcam feed
navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
        video.srcObject = stream;
    })
    .catch((err) => {
        console.error('Error accessing camera: ', err);
    });

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

recognition.onresult = async (event) => {
    const speech = event.results[0][0].transcript;
    recognizedText.innerText = `You said: ${speech}`;

    // Take a snapshot from the video
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg');

    // Use ngrok or your domain in production
    const response = await fetch('/query', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: speech, image: imageData })
    });

    const data = await response.json();
    speak(data.reply);
};

function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.4; // Human-like fast pace
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}
