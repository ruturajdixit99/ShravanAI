// Get DOM elements
const video = document.getElementById('video');
const recognizedText = document.getElementById('recognizedText');
const flipBtn = document.getElementById('flipBtn');
const statusDisplay = document.getElementById('cameraStatus');

// Camera state variables
let currentStream = null;
let videoDevices = [];
let currentDeviceIndex = 0;
let facingMode = 'user'; // Start with front camera
let isSwitchingCamera = false;

// Initialize webcam with selected device or facing mode
async function initCamera() {
    try {
        // Stop any existing stream
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }
        
        // Set status to loading
        statusDisplay.textContent = "Accessing camera...";
        
        // Set constraints based on available information
        let constraints;
        
        if (videoDevices.length > 1 && videoDevices[currentDeviceIndex].deviceId) {
            // If we have multiple device IDs, use them
            constraints = {
                video: { deviceId: { exact: videoDevices[currentDeviceIndex].deviceId } },
                audio: false
            };
            statusDisplay.textContent = `Using camera ${currentDeviceIndex + 1} of ${videoDevices.length}`;
        } else {
            // Fallback to facingMode approach
            constraints = {
                video: { facingMode: facingMode },
                audio: false
            };
            statusDisplay.textContent = `Using ${facingMode === 'user' ? 'front' : 'back'} camera`;
        }
        
        console.log('Using constraints:', constraints);
        
        // Get media stream
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
        
        // Show which camera is active
        const videoTrack = currentStream.getVideoTracks()[0];
        console.log('Active camera:', videoTrack.label);
        
        return true; // Success
    } catch (err) {
        console.error('Camera access error:', err);
        statusDisplay.textContent = `Camera error: ${err.message}`;
        return false; // Failed
    }
}

// Flip between available cameras
async function flipCamera() {
    // Prevent multiple rapid clicks
    if (isSwitchingCamera) {
        console.log('Already switching camera, please wait');
        return;
    }
    
    isSwitchingCamera = true;
    statusDisplay.textContent = "Switching camera...";
    
    try {
        if (videoDevices.length > 1) {
            // If we have properly enumerated multiple devices
            currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
            console.log(`Switching to device index ${currentDeviceIndex}`);
        } else {
            // Toggle facingMode for devices that don't report multiple cameras
            facingMode = facingMode === 'user' ? 'environment' : 'user';
            console.log(`Switching facingMode to ${facingMode}`);
        }
        
        // Try the primary approach
        let success = await initCamera();
        
        // If primary approach fails, try the alternate approach
        if (!success && videoDevices.length > 1) {
            console.log('Falling back to facingMode approach');
            facingMode = facingMode === 'user' ? 'environment' : 'user';
            success = await initCamera();
        }
        
        if (!success) {
            statusDisplay.textContent = "Failed to switch camera.";
        }
    } catch (err) {
        console.error('Error flipping camera:', err);
        statusDisplay.textContent = 'Error switching camera.';
    } finally {
        isSwitchingCamera = false;
    }
}

// Setup available devices on page load
async function setupDevices() {
    try {
        statusDisplay.textContent = "Requesting camera permission...";
        
        // First try to get permission
        const initialStream = await navigator.mediaDevices.getUserMedia({ video: true });
        
        // Stop this initial stream
        initialStream.getTracks().forEach(track => track.stop());
        
        // Then enumerate devices (works better after permission is granted)
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === "videoinput");
        
        console.log(`Found ${videoDevices.length} video devices:`, videoDevices);
        
        if (videoDevices.length === 0) {
            statusDisplay.textContent = "No camera found.";
            return;
        }
        
        // Initialize with first camera
        await initCamera();
        
    } catch (err) {
        console.error("Error initializing devices:", err);
        statusDisplay.textContent = `Setup error: ${err.message}`;
        
        // Try fallback approach with facingMode
        try {
            console.log('Trying fallback with facingMode');
            facingMode = 'user';
            await initCamera();
        } catch (fallbackErr) {
            console.error('Fallback failed:', fallbackErr);
            statusDisplay.textContent = "Could not access any camera.";
        }
    }
}

// Handle device change events (like plugging/unplugging cameras)
navigator.mediaDevices.addEventListener('devicechange', async () => {
    console.log('Device configuration changed');
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === "videoinput");
        
        // Ensure current index is valid
        if (currentDeviceIndex >= videoDevices.length) {
            currentDeviceIndex = 0;
        }
        
        // Update status
        statusDisplay.textContent = `Devices updated. Found ${videoDevices.length} cameras.`;
    } catch (err) {
        console.error('Error handling device change:', err);
    }
});

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
    document.getElementById('speakBtn').disabled = true;
    document.getElementById('speakBtn').textContent = "Speech recognition not supported";
    recognizedText.innerText = "Speech recognition is not supported in this browser.";
} else {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    function startListening() {
        try {
            recognition.start();
            recognizedText.innerText = "Listening...";
        } catch (err) {
            console.error('Recognition start error:', err);
            recognizedText.innerText = "Could not start listening. Try again.";
        }
    }

    // Handle recognition result
    recognition.onresult = async (event) => {
        const speech = event.results[0][0].transcript;
        recognizedText.innerText = `You said: ${speech}`;
        
        // Take snapshot from video
        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            const imageData = canvas.toDataURL('image/jpeg');
            
            // Send data to Flask
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
            console.error('Error processing image or server request:', err);
            recognizedText.innerText = `Error: ${err.message}`;
        }
    };

    // Error handling for speech recognition
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        recognizedText.innerText = `Recognition error: ${event.error}`;
    };
}

// Speech synthesis (assistant reply)
function speak(text) {
    if (!('speechSynthesis' in window)) {
        console.error('Speech synthesis not supported');
        return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.4; // More natural pace
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
}

// Make flipCamera function globally accessible for the onclick handler
window.flipCamera = flipCamera;
window.startListening = startListening;

// Start setup on page load
document.addEventListener('DOMContentLoaded', setupDevices);
