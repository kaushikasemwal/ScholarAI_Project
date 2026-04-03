"""
autoencoder.py — Semantic Embedding Autoencoder
================================================
Architecture:
  Encoder: 768 (or 384) → 512 → 256 → 128 (latent)
  Decoder: 128 → 256 → 512 → 768

Purpose (Advanced ML Component):
  - Compresses high-dimensional Sentence-BERT embeddings
  - Forces the network to learn a compact semantic representation
  - Denoises embeddings by discarding low-variance dimensions
  - The 128-dim latent vectors are fed to the BART summarizer
    to provide semantically rich, noise-reduced sentence selection

Training Objective:
  Minimize Mean Squared Error between input embeddings and
  reconstructed embeddings (standard autoencoder loss).

Evaluation Metrics:
  - Reconstruction loss (MSE)
  - Cosine similarity between original and reconstructed embeddings
  - ROUGE score improvement over baseline summarization (without AE)

Usage:
  ae = SemanticAutoencoder(input_dim=384, latent_dim=128)
  ae.train_on_corpus(sentences)          # Fine-tune on your data
  compressed = ae.encode(embeddings)     # (n, 384) → (n, 128)

Course: Advanced Topics in Machine Learning (HTML)
"""

import os, logging
from pathlib import Path
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

WEIGHTS_PATH = Path(__file__).parent.parent / "models" / "autoencoder_weights.pt"


class SemanticAutoencoder:
    """
    PyTorch autoencoder for semantic embedding compression.
    Falls back to PCA if PyTorch is unavailable.
    """

    def __init__(self, input_dim: int = 384, latent_dim: int = 128):
        self.input_dim  = input_dim
        self.latent_dim = latent_dim
        self.model      = None
        self.pca_fallback = None
        self._build_model()

    # ─── ARCHITECTURE ─────────────────────────────────────────────
    def _build_model(self):
        try:
            import torch
            import torch.nn as nn

            class _AE(nn.Module):
                def __init__(self, in_dim, lat_dim):
                    super().__init__()
                    # Encoder: progressively compress
                    self.encoder = nn.Sequential(
                        nn.Linear(in_dim, 512),
                        nn.ReLU(),
                        nn.BatchNorm1d(512),
                        nn.Dropout(0.1),

                        nn.Linear(512, 256),
                        nn.ReLU(),
                        nn.BatchNorm1d(256),
                        nn.Dropout(0.1),

                        nn.Linear(256, lat_dim),
                        nn.Tanh()          # Bounded latent space [-1, 1]
                    )
                    # Decoder: reconstruct original dimension
                    self.decoder = nn.Sequential(
                        nn.Linear(lat_dim, 256),
                        nn.ReLU(),
                        nn.BatchNorm1d(256),

                        nn.Linear(256, 512),
                        nn.ReLU(),
                        nn.BatchNorm1d(512),

                        nn.Linear(512, in_dim)
                        # No activation — embeddings are unbounded floats
                    )

                def forward(self, x):
                    latent = self.encoder(x)
                    recon  = self.decoder(latent)
                    return recon, latent

                def encode(self, x):
                    return self.encoder(x)

            self.model = _AE(self.input_dim, self.latent_dim)
            log.info(f"Autoencoder built: {self.input_dim} → {self.latent_dim} → {self.input_dim}")

        except ImportError:
            log.warning("PyTorch not available. PCA fallback will be used.")

    # ─── WEIGHTS ──────────────────────────────────────────────────
    def try_load_weights(self):
        """Load pre-trained weights if available."""
        if self.model is None: return
        if WEIGHTS_PATH.exists():
            try:
                import torch
                self.model.load_state_dict(torch.load(WEIGHTS_PATH, map_location="cpu"))
                self.model.eval()
                log.info(f"Loaded autoencoder weights from {WEIGHTS_PATH}")
            except Exception as e:
                log.warning(f"Could not load weights: {e}. Using random init.")
        else:
            log.info("No pre-trained weights found. Using random initialization.")
            if self.model: self.model.eval()

    def save_weights(self):
        if self.model is None: return
        import torch
        WEIGHTS_PATH.parent.mkdir(exist_ok=True)
        torch.save(self.model.state_dict(), WEIGHTS_PATH)
        log.info(f"Saved autoencoder weights → {WEIGHTS_PATH}")

    # ─── TRAINING ─────────────────────────────────────────────────
    def train_on_embeddings(self,
                             embeddings: np.ndarray,
                             epochs: int = 50,
                             batch_size: int = 32,
                             lr: float = 1e-3) -> list:
        """
        Train the autoencoder on a batch of sentence embeddings.

        Args:
            embeddings: np.ndarray of shape (N, input_dim)
            epochs:     number of training epochs
            batch_size: mini-batch size
            lr:         learning rate

        Returns:
            list of per-epoch training losses

        Training procedure:
          1. Shuffle embeddings each epoch
          2. Forward pass → encoder latent → decoder reconstruction
          3. MSE loss between input and reconstruction
          4. Backprop + Adam optimizer step
        """
        if self.model is None:
            log.warning("No PyTorch model — skipping training.")
            return []

        import torch
        import torch.nn as nn
        import torch.optim as optim

        self.model.train()
        optimizer = optim.Adam(self.model.parameters(), lr=lr, weight_decay=1e-5)
        criterion = nn.MSELoss()
        scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=20, gamma=0.5)

        X = torch.FloatTensor(embeddings)
        losses = []

        for epoch in range(epochs):
            # Shuffle
            perm = torch.randperm(len(X))
            X = X[perm]
            epoch_loss = 0.0
            n_batches  = 0

            for i in range(0, len(X), batch_size):
                batch = X[i: i + batch_size]
                optimizer.zero_grad()
                recon, _ = self.model(batch)
                loss = criterion(recon, batch)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()
                epoch_loss += loss.item()
                n_batches  += 1

            scheduler.step()
            avg_loss = epoch_loss / max(n_batches, 1)
            losses.append(avg_loss)

            if epoch % 10 == 0 or epoch == epochs - 1:
                log.info(f"AE Epoch {epoch+1:3d}/{epochs} | Loss: {avg_loss:.6f}")

        self.model.eval()
        self.save_weights()
        return losses

    def train_on_corpus(self, sentences: list, **kwargs):
        """Convenience method: encode sentences → train AE."""
        from sentence_transformers import SentenceTransformer
        sbert = SentenceTransformer("all-MiniLM-L6-v2")
        embeddings = sbert.encode(sentences, show_progress_bar=False, convert_to_numpy=True)
        return self.train_on_embeddings(embeddings, **kwargs)

    # ─── INFERENCE ────────────────────────────────────────────────
    def encode(self, embeddings: np.ndarray) -> np.ndarray:
        """
        Compress embeddings: (N, input_dim) → (N, latent_dim).
        Falls back to PCA if PyTorch is unavailable.
        """
        if self.model is not None:
            try:
                import torch
                with torch.no_grad():
                    x = torch.FloatTensor(embeddings)
                    latent = self.model.encode(x)
                    return latent.numpy()
            except Exception as e:
                log.warning(f"AE encode error: {e}. Using PCA fallback.")

        return self._pca_encode(embeddings)

    def decode(self, latent: np.ndarray) -> np.ndarray:
        """Reconstruct embeddings from latent space."""
        if self.model is not None:
            try:
                import torch
                with torch.no_grad():
                    z = torch.FloatTensor(latent)
                    recon = self.model.decoder(z)
                    return recon.numpy()
            except Exception as e:
                log.warning(f"AE decode error: {e}")
        return latent  # Cannot reconstruct without model

    def _pca_encode(self, embeddings: np.ndarray) -> np.ndarray:
        """PCA-based dimensionality reduction as a fallback."""
        try:
            from sklearn.decomposition import PCA
            if self.pca_fallback is None:
                self.pca_fallback = PCA(n_components=min(self.latent_dim,
                                                          embeddings.shape[1]))
                self.pca_fallback.fit(embeddings)
            return self.pca_fallback.transform(embeddings)
        except Exception:
            # Last resort: truncate
            return embeddings[:, :self.latent_dim]

    # ─── EVALUATION ───────────────────────────────────────────────
    def evaluate(self, embeddings: np.ndarray) -> dict:
        """
        Compute evaluation metrics:
          - reconstruction_mse: how well decoder reconstructs input
          - cosine_similarity:  semantic preservation metric
          - compression_ratio:  input_dim / latent_dim
        """
        compressed  = self.encode(embeddings)
        reconstructed = self.decode(compressed)

        mse = float(np.mean((embeddings - reconstructed) ** 2))

        from sklearn.metrics.pairwise import cosine_similarity as cos_sim
        sims = [
            cos_sim(embeddings[i:i+1], reconstructed[i:i+1])[0][0]
            for i in range(min(len(embeddings), 100))
        ]
        avg_cosine = float(np.mean(sims))

        return {
            "reconstruction_mse":    round(mse, 6),
            "avg_cosine_similarity": round(avg_cosine, 4),
            "compression_ratio":     round(self.input_dim / self.latent_dim, 2),
            "input_dim":             self.input_dim,
            "latent_dim":            self.latent_dim
        }

    def __repr__(self):
        return (f"SemanticAutoencoder("
                f"input={self.input_dim}, latent={self.latent_dim}, "
                f"pytorch={'available' if self.model else 'unavailable'})")


# ─── TRAINING SCRIPT ────────────────────────────────────────────
if __name__ == "__main__":
    """
    Train the autoencoder on a sample corpus.
    Run: python backend/autoencoder.py
    """
    import logging
    logging.basicConfig(level=logging.INFO)

    # Sample training sentences (replace with your corpus)
    sample_sentences = [
        "Machine learning is a subset of artificial intelligence.",
        "Deep learning uses multi-layer neural networks.",
        "Supervised learning requires labeled training data.",
        "Unsupervised learning finds patterns without labels.",
        "Transformers use self-attention mechanisms.",
        "BERT is a bidirectional encoder representation.",
        "GPT models are autoregressive language models.",
        "Gradient descent optimizes model parameters.",
        "Overfitting occurs when models memorize training data.",
        "Regularization techniques prevent overfitting.",
        "The vanishing gradient problem affects deep networks.",
        "Convolutional networks excel at image recognition.",
        "Recurrent networks handle sequential data.",
        "Attention mechanisms improve sequence-to-sequence models.",
        "Transfer learning leverages pre-trained representations.",
        "Fine-tuning adapts pre-trained models to new tasks.",
        "Autoencoders learn compressed data representations.",
        "Variational autoencoders generate new data samples.",
        "GANs use adversarial training for generation.",
        "Reinforcement learning optimizes cumulative reward.",
    ] * 20   # Repeat to create a small training corpus

    ae = SemanticAutoencoder(input_dim=384, latent_dim=128)
    print(f"Architecture: {ae}")
    losses = ae.train_on_corpus(sample_sentences, epochs=30, lr=1e-3)
    print(f"\nFinal training loss: {losses[-1]:.6f}")

    # Evaluate
    from sentence_transformers import SentenceTransformer
    sbert = SentenceTransformer("all-MiniLM-L6-v2")
    test_emb = sbert.encode(sample_sentences[:20], convert_to_numpy=True)
    metrics = ae.evaluate(test_emb)
    print("\nEvaluation Metrics:")
    for k, v in metrics.items():
        print(f"  {k}: {v}")
