import MediaPlayer
import SwiftUI

struct PickedMediaTrack {
    let persistentID: UInt64
    let title: String
    let artist: String
    let playbackDuration: TimeInterval
    let isCloudItem: Bool
}

struct MediaLibraryPicker: UIViewControllerRepresentable {
    var onSelect: (PickedMediaTrack) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIViewController(context: Context) -> MPMediaPickerController {
        let picker = MPMediaPickerController(mediaTypes: .music)
        picker.delegate = context.coordinator
        picker.allowsPickingMultipleItems = false
        picker.showsCloudItems = true
        picker.showsItemsWithProtectedAssets = true
        picker.prompt = "Choose a walk-up song"
        return picker
    }

    func updateUIViewController(_ uiViewController: MPMediaPickerController, context: Context) {}

    final class Coordinator: NSObject, MPMediaPickerControllerDelegate {
        private let parent: MediaLibraryPicker

        init(_ parent: MediaLibraryPicker) {
            self.parent = parent
        }

        func mediaPicker(_ mediaPicker: MPMediaPickerController, didPickMediaItems mediaItemCollection: MPMediaItemCollection) {
            if let item = mediaItemCollection.items.first {
                let track = PickedMediaTrack(
                    persistentID: item.persistentID,
                    title: item.title ?? "Untitled Song",
                    artist: item.artist ?? "",
                    playbackDuration: item.playbackDuration,
                    isCloudItem: item.isCloudItem
                )
                parent.onSelect(track)
            }
            parent.dismiss()
        }

        func mediaPickerDidCancel(_ mediaPicker: MPMediaPickerController) {
            parent.dismiss()
        }
    }
}
