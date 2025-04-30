const video = document.getElementById('video');
const recognizedText = document.getElementById('recognizedText');
const flipBtn = document.getElementById('flipBtn');
const statusDisplay = document.getElementById('cameraStatus');
let currentStream = null;
let videoDevices = [];
let currentDeviceIndex = 0;
let facingMode = 'user'; // Start with front camera

// Initialize webcam feed with selected device or facing mode
async function initCamera() {
    try {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }
        
        // Set constraints based on available information
        let constraints;
        
        if (videoDevices.length > 0 && videoDevices[currentDeviceIndex].deviceId) {
            // If we have device IDs, use them
            constraints = {
                video: { deviceId: { exact: videoDevices[currentDeviceIndex].deviceId } },
                audio: false
            };
            statusDisplay.textContent = `Using camera ${currentDeviceIndex + 1} of ${videoDevices.length}`;
        } else {
            // Fallback to facingMode approach for mobile browsers that don't enumerate devices properly
            constraints = {
                video: { facingMode: facingMode },
                audio: false
            };
            statusDisplay.textContent = `Using ${facingMode === 'user' ? 'front' : 'back'} camera`;
        }
        
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
        
        // Update UI to show active camera
        const videoTrack = currentStream.getVideoTracks()[0];
        console.log('Active camera:', videoTrack.label);
        
    } catch (err) {
        console.error('Error accessing camera: ', err);
        statusDisplay.textContent = `Camera error: ${err.message}`;
    }
}

// Flip between available cameras
async function flipCamera() {
    try {
        if (videoDevices.length > 1) {
            // If we have properly enumerated multiple devices
            currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
        } else {
            // Fallback for devices that don't report multiple cameras but have them
            facingMode = facingMode === 'user' ? 'environment' : 'user';
        }
        
        await initCamera();
    } catch (err) {
        console.error('Error flipping camera: ', err);
        statusDisplay.textContent = 'Error flipping camera. Please try again.';
    }
}

// Setup available devices on page load
async function setupDevices() {
    try {
        // First try to get permission
        await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        
        // Then enumerate devices (this works better after permission is granted)
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === "videoinput");
        
        console.log(`Found ${videoDevices.length} video devices:`, videoDevices);
        
        if (videoDevices.length === 0) {
            statusDisplay.textContent = "No camera found.";
            return;
        }
        
        await initCamera();
    } catch (err) {
        console.error("Error initializing devices: ", err);
        statusDisplay.textContent = `Setup error: ${err.message}`;
        
        // Try fallback approach
        try {
            facingMode = 'user';
            await initCamera();
        } catch (fallbackErr) {
            statusDisplay.textContent = "Could not access any camera.";
        }
    }
}

// Handle device change events (like plugging/unplugging cameras)
navigator.mediaDevices.addEventListener('devicechange', async () => {
    console.log('Device configuration changed');
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter(d => d.kind === "videoinput");
    
    // Ensure current index is valid
    if (currentDeviceIndex >= videoDevices.length) {
        currentDeviceIndex = 0;
    }
    
    // Update status
    statusDisplay.textContent = `Devices updated. Found ${videoDevices.length} cameras.`;
});

// Start setup on page load
document.addEventListener('DOMContentLoaded', setupDevices);

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = false;
recognition.lang = 'en-US';
recognition.interimResults = false;
recognition.maxAlternatives = 1;

function startListening() {
    recognition.start();
    recognizedText.innerText = "Listening...";
}

// Handle recognition result
recognition.onresult = async (event) => {
    const speech = event.results[0][0].transcript;
    recognizedText.innerText = `You said: ${speech}`;
    
    // Take snapshot from video
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg');
    
    // Send data to Flask
    try {
        const response = await fetch('/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: speech, image: imageData })
        });
        
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        speak(data.reply);
    } catch (err) {
        console.error('Error sending query to server:', err);
        recognizedText.innerText = `Error: ${err.message}`;
    }
};

// Error handling for speech recognition
recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    recognizedText.innerText = `Recognition error: ${event.error}`;
};

// Speech synthesis (assistant reply)
function speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.4; // More natural pace
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}
