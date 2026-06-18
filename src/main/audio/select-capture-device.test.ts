import { describe, expect, it } from 'vitest';
import { selectCaptureDevice, type ICaptureDevice } from './audio-capture.service';

const HEADSET: ICaptureDevice = { id: 'hs', name: 'Headphones (WH-1000XM5)', isDefault: true };
const SPEAKERS: ICaptureDevice = { id: 'sp', name: 'Speakers (Realtek(R) Audio)', isDefault: false };
const HDMI: ICaptureDevice = { id: 'hd', name: 'NVIDIA Output', isDefault: false };

describe('selectCaptureDevice', () => {
    it('should return the default device when no override is given', () => {
        // Arrange
        const devices: ICaptureDevice[] = [SPEAKERS, HEADSET, HDMI];

        // Act
        const selected: ICaptureDevice = selectCaptureDevice(devices);

        // Assert
        expect(selected).toBe(HEADSET);
    });

    it('should match an override by case-insensitive name substring over the default', () => {
        // Arrange
        const devices: ICaptureDevice[] = [HEADSET, SPEAKERS, HDMI];

        // Act
        const selected: ICaptureDevice = selectCaptureDevice(devices, 'realtek');

        // Assert
        expect(selected).toBe(SPEAKERS);
    });

    it('should fall back to the default when the override matches nothing', () => {
        // Arrange
        const devices: ICaptureDevice[] = [HEADSET, SPEAKERS];

        // Act
        const selected: ICaptureDevice = selectCaptureDevice(devices, 'nonexistent-device');

        // Assert
        expect(selected).toBe(HEADSET);
    });

    it('should fall back to the first device when none is flagged default and no override matches', () => {
        // Arrange
        const devices: ICaptureDevice[] = [
            { id: 'a', name: 'A', isDefault: false },
            { id: 'b', name: 'B', isDefault: false },
        ];

        // Act
        const selected: ICaptureDevice = selectCaptureDevice(devices);

        // Assert
        expect(selected.id).toBe('a');
    });

    it('should ignore a blank/whitespace override and use the default', () => {
        // Arrange
        const devices: ICaptureDevice[] = [HEADSET, SPEAKERS];

        // Act
        const selected: ICaptureDevice = selectCaptureDevice(devices, '   ');

        // Assert
        expect(selected).toBe(HEADSET);
    });
});
