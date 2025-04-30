// Get DOM elements
const video = document.getElementById('video');
const recognizedText = document.getElementById('recognizedText');
const flipBtn = document.getElementById('flipBtn');
const statusDisplay = document.getElementById('cameraStatus');

// Camera state variables
let currentStream = null;
let facingMode = 'user'; // Start with front camera (selfie)
let isSwitchingCamera = false;

// Initialize webcam with selected facing mode
async function initCamera() {
    try {
        // Stop any existing stream
        if (currentStream) {
            currentStream.getTracks().forEach(track => {
                track.stop();
            });
            currentStream = null;
        }
        
        // Set status to loading
        statusDisplay.textContent = "Accessing camera...";
        
        // Force stop and clear video source
        video.srcObject = null;
        
        // Wait a moment to ensure previous camera is fully released
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Set constraints specifically for mobile
        // IMPORTANT: Use exact constraint to force the specific camera
        const constraints = {
            video: {
                facingMode: { exact: facingMode }
            },
            audio: false
        };
        
        console.log(`Trying to access camera with facingMode: { exact: ${facingMode} }`);
        
        // Get media stream
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;
        
        // Log which camera is active
        const videoTrack = currentStream.getVideoTracks()[0];
        console.log('Active camera:', videoTrack.label);
        statusDisplay.textContent = `Using ${facingMode === 'user' ? 'front' : 'back'} camera`;
        
        return true; // Success
    } catch (err) {
        console.error('Camera access error:', err);
        
        // If "exact" constraint fails, try without "exact"
        if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
            try {
                console.log('Trying with relaxed constraints');
                const relaxedConstraints = {
                    video: { facingMode: facingMode },
                    audio: false
                };
                
                currentStream = await navigator.mediaDevices.getUserMedia(relaxedConstraints);
                video.srcObject = currentStream;
                
                const videoTrack = currentStream.getVideoTracks()[0];
                console.log('Active camera (relaxed):', videoTrack.label);
                statusDisplay.textContent = `Using ${facingMode === 'user' ? 'front' : 'back'} camera`;
                
                return true;
            } catch (relaxedErr) {
                console.error('Relaxed constraints also failed:', relaxedErr);
            }
        }
        
        statusDisplay.textContent = `Camera error: ${err.name}`;
        return false; // Failed
    }
}

// Flip between front and back cameras
async function flipCamera() {
    // Prevent multiple rapid clicks
    if (isSwitchingCamera) {
        console.log('Already switching camera, please wait');
        return;
    }
    
    isSwitchingCamera = true;
    statusDisplay.textContent = "Switching camera...";
    
    try {
        // Toggle between front and back camera
        facingMode = facingMode === 'user' ? 'environment' : 'user';
        console.log(`Attempting to switch to ${facingMode} camera`);
        
        // Try to initialize with new facing mode
        let success = await initCamera();
        
        if (!success) {
            console.log('First attempt failed, trying alternative approach');
            
            // If failed, try a different approach based on device
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            
            // iOS sometimes needs a longer delay to release camera resources
            if (isIOS) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Try one more time with simple constraints
            try {
                const simpleConstraints = {
                    video: true,
                    audio: false
                };
                
                // Stop any existing stream again to be sure
                if (currentStream) {
                    currentStream.getTracks().forEach(track => track.stop());
                    currentStream = null;
                }
                
                video.srcObject = null;
                
                // Try to get any camera
                currentStream = await navigator.mediaDevices.getUserMedia(simpleConstraints);
                video.srcObject = currentStream;
                
                statusDisplay.textContent = "Camera switched (basic mode)";
                console.log('Using basic camera mode');
            } catch (finalErr) {
                console.error('All camera switching attempts failed:', finalErr);
                statusDisplay.textContent = 'Could not switch camera';
            }
        }
    } catch (err) {
        console.error('Error in flipCamera function:', err);
        statusDisplay.textContent = 'Error switching camera';
    } finally {
        isSwitchingCamera = false;
    }
}

// Initialize the app on load
async function initApp() {
    try {
        statusDisplay.textContent = "Requesting camera permission...";
        
        // Request permission for video
        await navigator.mediaDevices.getUserMedia({ video: true });
        
        // Initialize with front camera
        await initCamera();
        
    } catch (err) {
        console.error("Error initializing app:", err);
        statusDisplay.textContent = `Camera error: ${err.message}`;
    }
}

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

// Make functions globally accessible
window.flipCamera = flipCamera;
window.startListening = startListening;

// Add debug function for mobile testing
window.debugCameraInfo = async function() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === "videoinput");
        console.log("Available cameras:", videoDevices);
        alert(`Found ${videoDevices.length} cameras: ${videoDevices.map(d => d.label || 'unnamed').join(', ')}`);
    } catch (err) {
        console.error("Debug error:", err);
        alert(`Debug error: ${err.message}`);
    }
};

// Initialize app on page load
document.addEventListener('DOMContentLoaded', initApp);
